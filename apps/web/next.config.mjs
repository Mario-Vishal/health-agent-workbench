const nextConfig = {
  output: process.env.NEXT_OUTPUT_MODE === "export" ? "export" : "standalone",
  transpilePackages: ["@healthagent/shared"],
};

export default nextConfig;
