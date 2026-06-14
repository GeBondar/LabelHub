import asyncio
import os
import re
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import config
from backend.models.annotation import Frame
from backend.services.websocket_manager import WebSocketManager


class VideoProcessor:
    def __init__(self, ffmpeg_path: str = None, ws_manager: Optional[WebSocketManager] = None):
        self.ffmpeg_path = ffmpeg_path or config.FFMPEG_PATH
        self.ffprobe_path = config.FFPROBE_PATH
        self.ws = ws_manager

    async def get_video_info(self, filepath: str) -> dict:
        cmd = [
            self.ffprobe_path,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            filepath,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"ffprobe failed: {stderr.decode()}")

        info = __import__("json").loads(stdout.decode())

        video_stream = None
        for stream in info.get("streams", []):
            if stream.get("codec_type") == "video":
                video_stream = stream
                break

        if video_stream is None:
            raise ValueError("No video stream found in file")

        fps_str = video_stream.get("r_frame_rate", "0/1")
        if "/" in fps_str:
            num, den = fps_str.split("/")
            fps = float(num) / float(den) if float(den) != 0 else 0.0
        else:
            fps = float(fps_str)

        duration_str = info.get("format", {}).get("duration", "0")
        duration = float(duration_str)

        nb_frames = video_stream.get("nb_frames")
        if nb_frames and nb_frames.isdigit():
            total_frames = int(nb_frames)
        else:
            total_frames = int(fps * duration) if fps > 0 else 0

        width = int(video_stream.get("width", 0))
        height = int(video_stream.get("height", 0))

        return {
            "fps": fps,
            "duration": duration,
            "total_frames": total_frames,
            "width": width,
            "height": height,
        }

    async def extract_frames(
        self,
        video_path: str,
        output_dir: str,
        target_fps: float,
        video_id: int,
        db_session: AsyncSession,
    ) -> list[dict]:
        os.makedirs(output_dir, exist_ok=True)

        video_info = await self.get_video_info(video_path)
        src_width = video_info["width"]
        src_height = video_info["height"]

        scale_filter = ""
        output_width = src_width
        output_height = src_height
        if src_width > config.MAX_FRAME_DIMENSION or src_height > config.MAX_FRAME_DIMENSION:
            scale_filter = f"scale='min({config.MAX_FRAME_DIMENSION},iw)':'min({config.MAX_FRAME_DIMENSION},ih)':force_original_aspect_ratio=decrease,"
            aspect = src_width / src_height if src_height > 0 else 1.0
            if src_width >= src_height:
                output_width = config.MAX_FRAME_DIMENSION
                output_height = int(config.MAX_FRAME_DIMENSION / aspect)
            else:
                output_height = config.MAX_FRAME_DIMENSION
                output_width = int(config.MAX_FRAME_DIMENSION * aspect)

        output_pattern = os.path.join(output_dir, "frame_%06d.jpg")

        cmd = [
            self.ffmpeg_path,
            "-i", video_path,
            "-vf", f"{scale_filter}fps={target_fps}",
            "-q:v", "2",
            "-progress", "pipe:1",
            "-nostats",
            "-y",
            output_pattern,
        ]

        task_id = f"extract_{video_id}"
        if self.ws:
            await self.ws.send_progress(task_id, 0, "Starting frame extraction...")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        total_duration = video_info["duration"]
        last_progress = 0

        async def read_progress():
            nonlocal last_progress
            buffer = b""
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    line = line.decode("utf-8", errors="replace").strip()
                    if line.startswith("out_time="):
                        time_str = line.split("=", 1)[1]
                        try:
                            parts = time_str.split(":")
                            if len(parts) == 3:
                                hours, minutes, seconds = parts
                                current_secs = float(hours) * 3600 + float(minutes) * 60 + float(seconds)
                                if total_duration > 0:
                                    pct = min(current_secs / total_duration * 100, 100)
                                    if pct - last_progress >= 1 and self.ws:
                                        last_progress = pct
                                        await self.ws.send_progress(task_id, pct, f"Extracting frames... {pct:.0f}%")
                        except (ValueError, IndexError):
                            pass

        await read_progress()
        await proc.wait()

        if proc.returncode != 0:
            stderr = await proc.stderr.read()
            raise RuntimeError(f"ffmpeg failed with code {proc.returncode}: {stderr.decode()}")

        if self.ws:
            await self.ws.send_progress(task_id, 95, "Creating frame records...")

        # Discover extracted frames
        created_frames = []
        frame_files = sorted(
            [f for f in os.listdir(output_dir) if f.endswith(".jpg") and f.startswith("frame_")]
        )

        from backend.models.project import Project, VideoFile
        from sqlalchemy import select as sa_select

        video_result = await db_session.execute(
            sa_select(VideoFile).where(VideoFile.id == video_id)
        )
        video_record = video_result.scalar()
        project_id_val = video_record.project_id if video_record else None

        for idx, filename in enumerate(frame_files):
            frame_path = os.path.join(output_dir, filename)
            frame = Frame(
                project_id=project_id_val,
                video_id=video_id,
                frame_index=idx,
                image_path=frame_path,
                width=output_width,
                height=output_height,
                is_labeled=False,
            )
            db_session.add(frame)
            created_frames.append(frame)

        await db_session.flush()

        if self.ws:
            await self.ws.send_progress(task_id, 100, f"Extraction complete: {len(created_frames)} frames")

        return [
            {"id": f.id, "frame_index": f.frame_index, "image_path": f.image_path}
            for f in created_frames
        ]
