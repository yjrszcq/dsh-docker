#!/usr/bin/env python3

import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def resize(master, cols, rows):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def write_all(target, data):
    remaining = memoryview(data)
    while remaining:
        written = os.write(target, remaining)
        remaining = remaining[written:]


def terminate(pid, requested_signal):
    try:
        os.killpg(pid, requested_signal)
    except ProcessLookupError:
        return
    except PermissionError:
        os.kill(pid, requested_signal)


def main():
    if len(sys.argv) != 4:
        raise RuntimeError("usage: pty-helper.py <cwd> <cols> <rows>")
    cwd = sys.argv[1]
    cols = int(sys.argv[2])
    rows = int(sys.argv[3])
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe("/bin/bash", ["/bin/bash", "-i"], os.environ)
    def stop_child(received_signal, _frame):
        terminate(pid, signal.SIGTERM if received_signal in (signal.SIGINT, signal.SIGTERM) else received_signal)
    signal.signal(signal.SIGINT, stop_child)
    signal.signal(signal.SIGTERM, stop_child)
    resize(master, cols, rows)
    stdin_fd = sys.stdin.fileno()
    stdin_buffer = b""
    stdin_open = True
    while True:
        readable, _, _ = select.select([master] + ([stdin_fd] if stdin_open else []), [], [], 0.25)
        if master in readable:
            try:
                data = os.read(master, 16384)
            except OSError:
                data = b""
            if not data:
                break
            emit({"type": "output", "data": base64.b64encode(data).decode("ascii")})
        if stdin_open and stdin_fd in readable:
            data = os.read(stdin_fd, 65536)
            if not data:
                stdin_open = False
                terminate(pid, signal.SIGHUP)
            else:
                stdin_buffer += data
                while b"\n" in stdin_buffer:
                    line, stdin_buffer = stdin_buffer.split(b"\n", 1)
                    command = json.loads(line.decode("utf-8"))
                    command_type = command.get("type")
                    if command_type == "input":
                        write_all(master, base64.b64decode(command["data"], validate=True))
                    elif command_type == "resize":
                        resize(master, int(command["cols"]), int(command["rows"]))
                    elif command_type == "signal":
                        terminate(pid, int(command["signal"]))
                    else:
                        raise RuntimeError("unknown PTY command")
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished == pid:
            if os.WIFEXITED(status):
                emit({"type": "exit", "code": os.WEXITSTATUS(status), "signal": None})
            else:
                emit({"type": "exit", "code": None, "signal": os.WTERMSIG(status)})
            os.close(master)
            return
    _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        emit({"type": "exit", "code": os.WEXITSTATUS(status), "signal": None})
    else:
        emit({"type": "exit", "code": None, "signal": os.WTERMSIG(status)})
    os.close(master)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "error", "message": str(error)})
        sys.exit(1)
