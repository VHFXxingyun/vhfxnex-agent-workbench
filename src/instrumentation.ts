export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel("vhfxnex-goalflow");
    await import("./lib/runtime-env");
  }
}
