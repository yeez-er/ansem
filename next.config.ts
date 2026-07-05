import type { NextConfig } from "next";
import { parseServerEnv } from "./src/env";

// Fail dev/build fast on a malformed environment (spec 000). Next loads
// .env* files before evaluating this config, so local values are visible here.
parseServerEnv(process.env);

const nextConfig: NextConfig = {/* config options here */};

export default nextConfig;
