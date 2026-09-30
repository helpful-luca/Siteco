"""The EICAR anti-virus test file, assembled at runtime.

Never stored in one piece: a committed EICAR string makes scanners on developer machines and
in CI quarantine the repository. The file is harmless by design; every scanner flags it.
"""


def eicar() -> bytes:
    head = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$"
    tail = "EICAR-STANDARD-" + "ANTIVIRUS-TEST-FILE!$H+H*"
    return (head + tail).encode("ascii")
