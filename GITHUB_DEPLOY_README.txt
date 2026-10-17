BingoC — GitHub Pages upload package
===================================

1. GitHub New repository: name "bingoc", public (for free GitHub Pages).
2. Unzip this package. Upload the contents of this folder — NOT the ZIP itself — into the repository root.
   Keep the folder named assets with both GIF files.
3. GitHub repository > Settings > Pages > Source: Deploy from a branch > Branch: main > /(root) > Save.
4. After deployment check the GitHub Pages URL (https://YOUR-USER.github.io/bingoc/).
   Set Firebase Authentication > Settings > Authorized domains to include YOUR-USER.github.io if needed.
5. Use the same ?room=AACC2026 for host.html, tv.html, phone.html. Open HOST FIRST and sign in, to create the room lobby.
6. Open TV on another browser/device. Open PHONE on each player phone; join with a name.
7. Test with 2 or 3 phones and check Realtime Database data before letting all players join.

Site paths:
 https://YOUR-USER.github.io/bingoc/host.html?room=AACC2026
 https://YOUR-USER.github.io/bingoc/tv.html?room=AACC2026
 https://YOUR-USER.github.io/bingoc/phone.html?room=AACC2026

The site source code is public. Keep the host password private; the Web Config is not a password.
The real Firebase database Security Rules are NOT part of this zip: they must already be published in the Firebase Console.
Do NOT use the local prototype for real multiplayer.
