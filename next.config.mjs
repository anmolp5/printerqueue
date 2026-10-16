/** @type {import('next').NextConfig} */
const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig = {
  reactStrictMode: false,
  staticPageGenerationTimeout: 120,
  ...(isGithubPages
    ? {
        output: "export",
        basePath: "/printerqueue",
        trailingSlash: true,
        images: {
          unoptimized: true,
        },
      }
    : {}),
};

export default nextConfig;
