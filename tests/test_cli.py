# tests/test_cli.py
import pytest
from unittest.mock import patch

from fviewer.cli import main, open_browser, open_file_on_startup


# --- Function Tests ---

@patch("fviewer.cli.webbrowser.open")
def test_open_browser(mock_open):
    """Test that the browser opener calls the stdlib webbrowser module."""
    open_browser("http://127.0.0.1:8000")
    mock_open.assert_called_once_with("http://127.0.0.1:8000")


@patch("fviewer.cli.FViewer")
def test_open_file_on_startup_success(mock_fviewer):
    """Test the background worker successfully loads a file."""
    # Setup our mock instance
    mock_fv_instance = mock_fviewer.return_value

    open_file_on_startup("data/test.fits", host="localhost", port=9000)

    # Verify FViewer was instantiated correctly
    mock_fviewer.assert_called_once_with(host="localhost", port=9000)

    # Verify the sequence of commands
    mock_fv_instance.wait_for_ready.assert_called_once()
    mock_fv_instance.load_file.assert_called_once_with("data/test.fits")


@patch("fviewer.cli.FViewer")
@patch("builtins.print")
def test_open_file_on_startup_exception(mock_print, mock_fviewer):
    """Test that startup exceptions are safely caught and printed."""
    # Force wait_for_ready to crash
    mock_fviewer.return_value.wait_for_ready.side_effect = Exception(
        "Server timeout")

    open_file_on_startup("data/test.fits")

    # Verify it didn't crash the thread, and printed the error
    mock_print.assert_called_with(
        "Failed to load file on startup: Server timeout")


# --- Main CLI Argument Tests ---

@patch("fviewer.cli.uvicorn.run")
@patch("fviewer.cli.threading.Timer")
@patch("fviewer.cli.threading.Thread")
@patch("sys.argv", ["fviewer"])  # Mock empty command line arguments
def test_main_defaults(mock_thread, mock_timer, mock_uvicorn):
    """Test CLI behavior with no arguments."""
    main()

    # 1. It should schedule the browser to open
    mock_timer.assert_called_once()
    args, kwargs = mock_timer.call_args
    assert args[0] == 1.0  # 1 second delay
    assert args[1] == open_browser
    assert kwargs['args'] == ("http://127.0.0.1:8000",)

    # 2. It should NOT spawn the file-loader thread
    mock_thread.assert_not_called()

    # 3. It should start uvicorn
    mock_uvicorn.assert_called_once()


@patch("fviewer.cli.uvicorn.run")
@patch("fviewer.cli.threading.Timer")
@patch("sys.argv", ["fviewer", "--no-browser", "--port", "9000"])
def test_main_no_browser_flag(mock_timer, mock_uvicorn):
    """Test that --no-browser suppresses the Timer thread."""
    main()
    mock_timer.assert_not_called()

    # Verify port argument was passed to uvicorn
    args, kwargs = mock_uvicorn.call_args
    print(args, kwargs)
    assert kwargs["port"] == 9000


@patch("fviewer.cli.uvicorn.run")
@patch("fviewer.cli.os.path.exists")
@patch("sys.argv", ["fviewer", "ghost.fits"])
def test_main_missing_file(mock_exists, mock_uvicorn, capsys):
    """Test that a bad file path triggers sys.exit(1)."""
    mock_exists.return_value = False

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 1
    mock_uvicorn.assert_not_called()  # Server should not start!


# @patch("fviewer.cli.open_file_on_startup")
@patch("fviewer.cli.uvicorn.run")
@patch("fviewer.cli.threading.Thread")
@patch("fviewer.cli.threading.Timer")
@patch("fviewer.cli.os.path.exists")
@patch("sys.argv", ["fviewer", "real.fits"])
def test_main_valid_file(mock_exists, mock_timer, mock_thread, mock_uvicorn):
    """Test providing a valid file spawns the loader thread."""
    mock_exists.return_value = True

    main()

    # Thread should be started with the right target
    mock_thread.assert_called_once()
    _, kwargs = mock_thread.call_args
    assert kwargs["target"] == open_file_on_startup
    assert kwargs["daemon"] is True
