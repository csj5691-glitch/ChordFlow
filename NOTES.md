# Notes

## BPM YT (yt-dlp)

Important : la mesure du BPM d'une vidéo YouTube (route `/api/yt-bpm`) tourne
sur la machine locale (yt-dlp + ffmpeg installés, cache en mémoire). Sur une
prod serverless (Vercel) ça ne marchera pas — il faudrait un serveur Node
dédié pour l'exécuter.