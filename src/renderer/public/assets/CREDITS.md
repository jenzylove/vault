# Asset credits

The vault has no downloaded assets. Everything on screen (the red velvet wall, the safe deposit doors and safes,
dials, chains and padlocks, cash, gold bars, jewels, the dye pack, coins, the Fence and his booth, marquee signs,
the breath meter, the pulse bulb and the alarm beacon) is modelled and textured procedurally in
`src/renderer/scene/` and is original to this project.

## Voice

The Fence's lines are recorded once at build time with the Microsoft neural voice en-US-ChristopherNeural through edge-tts (scripts/voice/gen.py), then pitched and filtered with ffmpeg. The game plays the files from disk.
