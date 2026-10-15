"""Harmless deterministic terminal output. No input, files, secrets or network."""
import os
import time
state = 0x41C0FFEE

def next_u32():
    global state
    state ^= (state << 13) & 0xFFFFFFFF
    state ^= state >> 17
    state ^= (state << 5) & 0xFFFFFFFF
    state &= 0xFFFFFFFF
    return state

lines = ['PR41 seed 41c0ffee\n']
for index in range(4):
    lines.append(f'fixture {index:02d} sample {next_u32():08x}\n')
lines.append('\x1b[32msynthetic terminal output complete\x1b[0m\n')
for line in lines:
    os.write(1, line.encode('utf-8'))
    time.sleep(0.02)
