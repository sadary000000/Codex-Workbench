import { open } from "node:fs/promises";

export interface WebGptTextOutput {
  outputPath: string;
  outputBytes: number;
}

export async function writeWebGptTextOutput(
  outputPath: string,
  text: string,
  conflict: { code: string; message: string },
): Promise<WebGptTextOutput> {
  const bytes = Buffer.from(text, "utf8");
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(outputPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if ((error as { code?: string })?.code === "EEXIST") {
      const outputError = new Error(conflict.message) as Error & { code: string };
      outputError.code = conflict.code;
      throw outputError;
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return { outputPath, outputBytes: bytes.byteLength };
}
