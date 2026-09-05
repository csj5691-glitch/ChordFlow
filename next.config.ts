import { withSerwist } from "@serwist/turbopack";

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  /* config options here */
};

export default withSerwist(nextConfig);
