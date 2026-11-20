# TapSafe demo script (target 2:30, limit 3:00)

Record in desktop Chrome with Gemini Nano enabled. Quota build: `npm run dev -- --mode quota`.
Screen-record the browser tab plus the phone/camera view if available; keep voice-over short.

| Time | Show | Say |
|---|---|---|
| 0:00 | Title, app header with "On-device model: ready · Cloud: ready" | A blind shopper cannot read the amount on a card terminal. TapSafe reads it aloud before they tap. |
| 0:15 | Enter 180. Sample "Café, correct amount" | Nano reads the screen on the device. Two rising notes: matches, safe to tap. Badge: On-device, with milliseconds. |
| 0:40 | Sample "Café, overcharged" (shows 1,800) | Mismatch. Three low pulses: stop. Nothing has left the phone. |
| 1:00 | Sample "Photo with glare" | Nano is unsure, so it asks before sending the photo to the cloud. Say yes. Badge: Cloud · Gemini. |
| 1:25 | "Write a note for the shop or bank" | Only amounts, shop name and time go to the cloud, never the photo. |
| 1:45 | "Or photograph the bill" with a long printed bill | A larger model itemises it. TapSafe re-adds every line itself, flags service charge and duplicates. |
| 2:15 | Settings: turn off cloud, scan again | Works offline on the device. |
| 2:30 | Architecture slide / README table | Hybrid: device first, cloud only when it changes the answer, App Check on the cloud endpoint. |

Checklist before recording: Nano model downloaded, camera permission granted, speakers on, notifications off,
cloud path tested (done 21 Nov against the quota project), submit video as public YouTube or Drive link.
