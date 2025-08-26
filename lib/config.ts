export const config = {
  isProduction: process.env.NODE_ENV === "production",
  isVercel: Boolean(process.env.VERCEL),
  templateRoot: process.env.TEMPLATE_ROOT || process.cwd(),
  tempDir: process.env.VERCEL ? "/tmp" : require("os").tmpdir(),
};
