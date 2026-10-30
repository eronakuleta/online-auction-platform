// Reads frontend configuration from Vite env variables once, and fails fast if one is missing.

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}

export const apiBaseUrl = requireEnv(
  'VITE_API_BASE_URL',
  import.meta.env.VITE_API_BASE_URL as string | undefined,
).replace(/\/+$/, '');
