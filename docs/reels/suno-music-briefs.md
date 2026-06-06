# Reel Music Library — Suno Prompt Briefs

Generate these in **Suno Pro** (commercial license required — don't use the free tier for published Reels). Aim for **3–6 tracks per category** with BPM/length variety so the auto-picker has options. Download each as MP3 or WAV. We'll store them in a `music_beds` Supabase bucket and a `music_beds` table (category, name, duration, bpm, file_path, license_proof_url).

Each track should be **instrumental** (no vocals — they fight the listing), **loop-friendly**, and **8–20s usable** (Reels are short; we trim with `-shortest`). Keep intros short (≤1s) so the music lands immediately.

A good Suno prompt = **mood + genre + instrumentation + tempo + "instrumental, no vocals, clean loop."** Paste-ready prompts below.

---

## 1. Luxury listing
Premium, confident, aspirational. Think high-end real estate sizzle reel.
- **BPM:** 90–110 · **Feel:** cinematic, polished, restrained
- **Prompt:** `Cinematic luxury real estate background, warm piano and lush strings with a subtle deep sub-bass and soft electronic pulse, elegant and aspirational, slow build, instrumental, no vocals, clean seamless loop, 100 BPM`
- Variations: swap "warm piano" → "muted trumpet + Rhodes" for a jazzier estate feel; drop to 88 BPM for ultra-premium.

## 2. Beach house
Bright, breezy, coastal. Shore-town listings (Cape May, Wildwood, Ocean City).
- **BPM:** 100–115 · **Feel:** sunny, relaxed, hopeful
- **Prompt:** `Breezy coastal indie-pop instrumental, bright acoustic guitar, ukulele, light hand percussion and soft synth pads, sunny and relaxed beach-house vibe, instrumental, no vocals, clean loop, 108 BPM`
- Variations: add "gentle steel-drum accents" for a more tropical take; "lo-fi tape warmth" for a chill version.

## 3. Modern condo
Sleek, urban, contemporary. Clean lines, downtown energy.
- **BPM:** 110–122 · **Feel:** crisp, minimal, stylish
- **Prompt:** `Sleek modern deep-house instrumental, minimal four-on-the-floor groove, crisp electronic plucks, warm bass, airy pads, stylish and contemporary, instrumental, no vocals, clean loop, 118 BPM`
- Variations: "downtempo organic house with marimba" for a softer modern feel.

## 4. Family home
Warm, friendly, heartfelt-but-upbeat. The "imagine your life here" sweet spot.
- **BPM:** 95–110 · **Feel:** warm, optimistic, homey
- **Prompt:** `Warm uplifting acoustic instrumental, fingerpicked guitar, soft piano, light claps and gentle glockenspiel, friendly optimistic family vibe, instrumental, no vocals, clean loop, 102 BPM`
- Variations: add "subtle whistle melody" for extra friendliness; strings swell for the emotional close.

## 5. Fast-paced open house
Energetic, momentum, "come see it this weekend." Drives urgency.
- **BPM:** 120–135 · **Feel:** punchy, exciting, propulsive
- **Prompt:** `Energetic upbeat pop instrumental, driving drums, bright synth stabs, claps and a catchy plucked hook, exciting and propulsive, event-promo energy, instrumental, no vocals, clean loop, 128 BPM`
- Variations: "funky guitar + brass hits" for a livelier open-house feel.

## 6. Soft emotional seller story
Tender, reflective, sentimental. Just-sold / "thank you" / owner-story Reels.
- **BPM:** 70–90 · **Feel:** gentle, emotional, sincere
- **Prompt:** `Tender emotional piano instrumental, soft felt piano with warm strings and subtle ambient pads, reflective and heartfelt, gentle build, instrumental, no vocals, clean loop, 80 BPM`
- Variations: add "light acoustic guitar" for warmth; solo piano only for the most intimate version.

## 7. High-energy recruiting
Bold, motivating, "join our team." Agent recruiting + brand hype.
- **BPM:** 125–140 · **Feel:** confident, driving, anthemic
- **Prompt:** `Bold motivational corporate-anthem instrumental, driving drums, big synth swells, confident piano chords and uplifting brass, empowering and ambitious, instrumental, no vocals, clean loop, 130 BPM`
- Variations: "hip-hop-influenced trap beat, confident and modern" for a younger recruiting vibe.

## 8. Clean corporate background
Neutral, professional, unobtrusive. Stats, market updates, explainer Reels.
- **BPM:** 100–115 · **Feel:** light, modern, neutral
- **Prompt:** `Clean modern corporate background instrumental, light plucked synth, soft piano, steady gentle beat and airy pads, neutral professional and unobtrusive, instrumental, no vocals, clean loop, 110 BPM`
- Variations: "minimal lo-fi corporate" for a softer bed.

---

## After you generate
1. Name files clearly: `luxury_01.mp3`, `beachhouse_02.mp3`, etc.
2. Note each track's **BPM + duration** (we'll store them so the picker can match pace).
3. Keep the Suno **ownership/receipt** page screenshot per track (license proof — required for published commercial use).
4. Hand them over and I'll build the `music_beds` table + bucket, wire the picker, and add the FFmpeg embed in the worker so the chosen track bakes into the MP4.
