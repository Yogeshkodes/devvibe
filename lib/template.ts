import path from "path";

export const templatePaths = {
  REACT: "starters-main/react-ts",
  NEXTJS: "starters-main/nextjs-new",
  EXPRESS: "starters-main/express-simple",
  VUE: "starters-main/vue",
  HONO: "starters-main/hono-nodejs-starter",
  ANGULAR: "starters-main/angular",
};

export function getTemplatePath(templateKey: keyof typeof templatePaths) {
  return path.join(process.cwd(), templatePaths[templateKey]);
}
