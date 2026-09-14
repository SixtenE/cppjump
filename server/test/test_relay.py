#!/usr/bin/env python3
"""Security regression tests for the Jump Prince WebSocket relay."""
from __future__ import annotations

import json
import os
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_BIN = ROOT / "build" / "jump_server"


class WsSock:
    def __init__(self, sock: socket.socket, leftover: bytes = b""):
        self.sock = sock
        self.leftover = leftover

    def sendall(self, data: bytes) -> None:
        self.sock.sendall(data)

    def recv(self, n: int) -> bytes:
        if self.leftover:
            take = self.leftover[:n]
            self.leftover = self.leftover[n:]
            if len(take) == n:
                return take
            rest = self.sock.recv(n - len(take))
            return take + rest
        return self.sock.recv(n)

    def settimeout(self, t: float) -> None:
        self.sock.settimeout(t)

    def close(self) -> None:
        self.sock.close()


def ws_connect(host: str, port: int, timeout: float = 3.0) -> WsSock:
    key = os.urandom(16)
    import base64

    b64 = base64.b64encode(key).decode()
    s = socket.create_connection((host, port), timeout=timeout)
    req = (
        f"GET / HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {b64}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    )
    s.sendall(req.encode())
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = s.recv(4096)
        if not chunk:
            raise ConnectionError("handshake closed")
        data += chunk
    if b"101" not in data.split(b"\r\n", 1)[0]:
        raise ConnectionError(f"bad handshake: {data[:80]!r}")
    leftover = data.split(b"\r\n\r\n", 1)[1]
    s.settimeout(timeout)
    return WsSock(s, leftover)


def _sock_recv(sock: WsSock, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed")
        buf += chunk
    return bytes(buf)


def ws_send_text(sock: socket.socket, text: str, *, masked: bool = True) -> None:
    payload = text.encode()
    hdr = bytearray()
    hdr.append(0x81)
    n = len(payload)
    mask_bit = 0x80 if masked else 0
    if n <= 125:
        hdr.append(mask_bit | n)
    elif n <= 65535:
        hdr.append(mask_bit | 126)
        hdr += struct.pack("!H", n)
    else:
        hdr.append(mask_bit | 127)
        hdr += struct.pack("!Q", n)
    if masked:
        mask = os.urandom(4)
        hdr += mask
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(bytes(hdr) + payload)


def ws_send_raw_len(sock: socket.socket, claimed_len: int) -> None:
    """Send a text frame header claiming claimed_len, with a tiny body."""
    hdr = bytearray()
    hdr.append(0x81)
    hdr.append(0x80 | 127)
    hdr += struct.pack("!Q", claimed_len)
    mask = os.urandom(4)
    hdr += mask
    sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(b"{}")))


def ws_recv_text(sock: socket.socket) -> str:
    hdr0 = _sock_recv(sock, 1)[0]
    hdr1 = _sock_recv(sock, 1)[0]
    opcode = hdr0 & 0x0F
    masked = (hdr1 & 0x80) != 0
    n = hdr1 & 0x7F
    if n == 126:
        n = struct.unpack("!H", _sock_recv(sock, 2))[0]
    elif n == 127:
        n = struct.unpack("!Q", _sock_recv(sock, 8))[0]
    mask = _sock_recv(sock, 4) if masked else b""
    payload = bytearray(_sock_recv(sock, n))
    if masked:
        payload = bytearray(b ^ mask[i % 4] for i, b in enumerate(payload))
    if opcode == 0x8:
        raise ConnectionError("close")
    if opcode == 0x9:
        return ws_recv_text(sock)
    return payload.decode()


def recv_json_of_type(sock: socket.socket, typ: str, tries: int = 8) -> dict:
    for _ in range(tries):
        msg = json.loads(ws_recv_text(sock))
        if msg.get("type") == typ:
            return msg
    raise AssertionError(f"did not receive {typ}")


def wait_port(host: str, port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError(f"server did not listen on {port}")


def pick_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(port: int) -> subprocess.Popen:
    if not SERVER_BIN.exists():
        raise SystemExit(f"missing {SERVER_BIN}; run `make` first")
    return subprocess.Popen(
        [str(SERVER_BIN), str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def test_id_name_cannot_be_spoofed(port: int) -> None:
    a = ws_connect("127.0.0.1", port)
    b = ws_connect("127.0.0.1", port)
    ws_send_text(a, json.dumps({"type": "hello", "name": "Alice"}))
    init_a = recv_json_of_type(a, "init")
    alice_id = init_a["id"]

    ws_send_text(b, json.dumps({"type": "hello", "name": "Bob"}))
    init_b = recv_json_of_type(b, "init")
    bob_id = init_b["id"]
    assert bob_id != alice_id

    # Alice should see Bob join with the real name.
    join = recv_json_of_type(a, "join")
    assert join["player"]["name"] == "Bob"
    assert join["player"]["id"] == bob_id

    ws_send_text(
        b,
        json.dumps(
            {
                "type": "state",
                "id": alice_id,
                "name": "Admin",
                "type": "state",
                "extra": "nope",
                "position": {"x": 3, "y": 4},
                "velocity": {"x": 0, "y": 0},
                "facing": True,
                "onGround": True,
                "animTime": 0,
                "sprite": 1,
                "screen": 0,
            }
        ),
    )

    # Wait for a snapshot on Alice that includes Bob.
    bob_entry = None
    for _ in range(20):
        msg = json.loads(ws_recv_text(a))
        if msg.get("type") != "snapshot":
            continue
        for p in msg.get("players", []):
            if p.get("id") == bob_id:
                bob_entry = p
                break
        if bob_entry:
            break
    assert bob_entry is not None, "never saw Bob in a snapshot"
    assert bob_entry["name"] == "Bob", bob_entry
    assert bob_entry["id"] == bob_id
    assert "extra" not in bob_entry
    assert bob_entry["position"]["x"] == 3
    a.close()
    b.close()


def test_name_truncated(port: int) -> None:
    c = ws_connect("127.0.0.1", port)
    observer = ws_connect("127.0.0.1", port)
    ws_send_text(observer, json.dumps({"type": "hello", "name": "Obs"}))
    recv_json_of_type(observer, "init")
    long_name = "A" * 200
    ws_send_text(c, json.dumps({"type": "hello", "name": long_name}))
    join = recv_json_of_type(observer, "join")
    assert len(join["player"]["name"]) <= 24
    assert join["player"]["name"] == "A" * 24
    c.close()
    observer.close()


def test_oversized_frame_rejected(port: int) -> None:
    s = ws_connect("127.0.0.1", port)
    # Claim a 1GB payload; server must close without allocating it.
    ws_send_raw_len(s, 1_000_000_000)
    s.settimeout(2)
    try:
        data = s.recv(16)
        # Either close frame or EOF is acceptable.
        assert data == b"" or (data and (data[0] & 0x0F) == 0x8)
    except OSError:
        pass
    s.close()


def test_unmasked_frame_rejected(port: int) -> None:
    s = ws_connect("127.0.0.1", port)
    ws_send_text(s, json.dumps({"type": "hello", "name": "X"}), masked=False)
    s.settimeout(2)
    try:
        data = s.recv(16)
        assert data == b"" or (data and (data[0] & 0x0F) == 0x8)
    except OSError:
        pass
    s.close()


def test_non_string_name_defaults(port: int) -> None:
    observer = ws_connect("127.0.0.1", port)
    ws_send_text(observer, json.dumps({"type": "hello", "name": "Obs"}))
    recv_json_of_type(observer, "init")
    c = ws_connect("127.0.0.1", port)
    ws_send_text(c, json.dumps({"type": "hello", "name": 12345}))
    join = recv_json_of_type(observer, "join")
    assert join["player"]["name"] == "Prince"
    c.close()
    observer.close()


def _is_valid_utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def test_invalid_utf8_name_not_relayed(port: int) -> None:
    """A malicious client must not be able to make the server emit a frame
    with invalid UTF-8, which would fail every other client's connection
    (RFC 6455 requires text frames to be valid UTF-8)."""
    observer = ws_connect("127.0.0.1", port)
    ws_send_text(observer, json.dumps({"type": "hello", "name": "Obs"}))
    recv_json_of_type(observer, "init")

    mal = ws_connect("127.0.0.1", port)
    # A lone high surrogate (\uD800) followed by regular text. Decoded naively
    # this yields the invalid byte sequence ED A0 80; the server must never
    # relay that, or every other client's browser would drop the connection.
    ws_send_text(mal, '{"type":"hello","name":"\\uD800bad"}')

    # Every frame the observer receives must be valid UTF-8.
    saw_join = False
    for _ in range(20):
        hdr0 = _sock_recv(observer, 1)[0]
        hdr1 = _sock_recv(observer, 1)[0]
        opcode = hdr0 & 0x0F
        n = hdr1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", _sock_recv(observer, 2))[0]
        elif n == 127:
            n = struct.unpack("!Q", _sock_recv(observer, 8))[0]
        payload = _sock_recv(observer, n)
        if opcode == 0x8:
            break
        if opcode in (0x9, 0xA):
            continue
        assert _is_valid_utf8(payload), f"server emitted invalid UTF-8: {payload!r}"
        msg = json.loads(payload.decode("utf-8"))
        if msg.get("type") == "join":
            name = msg["player"]["name"]
            # The regular text survives; no lone-surrogate bytes leak through.
            assert "bad" in name, f"unexpected relayed name: {name!r}"
            assert b"\xed\xa0\x80" not in name.encode("utf-8")
            saw_join = True
            break
    assert saw_join, "never saw the malicious client's join"
    mal.close()
    observer.close()


def main() -> int:
    port = pick_port()
    proc = start_server(port)
    try:
        wait_port("127.0.0.1", port)
        test_id_name_cannot_be_spoofed(port)
        test_name_truncated(port)
        test_oversized_frame_rejected(port)
        test_unmasked_frame_rejected(port)
        test_non_string_name_defaults(port)
        test_invalid_utf8_name_not_relayed(port)
        print("test_relay: ok")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
