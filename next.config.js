/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // WebRTC + getUserMedia dislike double-mounting in dev
};
module.exports = nextConfig;
