# Contributing to LabelHub

Thanks for your interest in improving LabelHub! Issues and pull requests are
welcome. For larger changes, please open an issue first to discuss the direction.

## Development setup

Prerequisites: **Python 3.10+** and **Node.js 18+** on your `PATH`.

```bash
git clone https://github.com/GeBondar/LabelHub.git
cd LabelHub

# One-time setup (creates the venv, installs deps, builds the web bundle)
#   Windows:        install.cmd
#   Linux / macOS:  ./install.sh

# Run the app
#   Windows:        run.cmd
#   Linux / macOS:  ./run.sh
```

For frontend work with hot reload (auto-starts the backend):

```bash
cd electron && npm start
```

## Before submitting a pull request

Please make sure both checks pass — CI runs the same ones:

```bash
# Backend tests (fast; torch is not required to run them)
pip install -r backend/requirements-dev.txt
python -m pytest

# Frontend build
cd electron && npm run build:web
```

- Keep new user-facing strings translatable: add them via `t('English text')`
  and register the Russian translation with `addTranslations({ ... })` in the
  component (see existing components for the pattern). English is the source and
  default; missing translations fall back to it.
- Match the style of the surrounding code (naming, comments, formatting).
- Add or update tests when you change backend behavior.

## Reporting bugs vs. requesting features

Use the GitHub issue templates:
- **Bug report** — include your OS, app version, steps to reproduce, and what you expected.
- **Feature request** — describe the use case and the outcome you want.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
