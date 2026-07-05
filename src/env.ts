import { z } from "zod";

// `KEY=` lines in dotenv files arrive as "" — normalize blank to undefined so
// an empty value can never satisfy a presence check downstream.
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

// Optional feature flags must be exactly "true"/"false" — a typo like "yes"
// fails the boot-time parse instead of silently meaning false.
const optionalBooleanString = z.preprocess(
  blankToUndefined,
  z.enum(["true", "false"]).optional(),
);

// Metrics provider mode (spec 003): a typo like "socialdata" fails boot
// instead of silently selecting the dev/prod default.
const optionalProviderMode = z.preprocess(
  blankToUndefined,
  z.enum(["mock", "live"]).optional(),
);

// Numeric tunables (spec 004): must be a positive integer — "0", negatives,
// fractions, and junk fail the boot-time parse instead of silently breaking
// the ingestion batch bound.
const optionalPositiveInt = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^[1-9][0-9]*$/, { message: "must be a positive integer" })
    .transform(Number)
    .optional(),
);

const serverEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "must be a postgres:// or postgresql:// connection string",
    }),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: optionalString,
  CLERK_SECRET_KEY: optionalString,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: optionalString,
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: optionalString,
  CRON_SECRET: optionalString,
  METRICS_PROVIDER: optionalProviderMode,
  METRICS_PROVIDER_X: optionalProviderMode,
  METRICS_PROVIDER_TIKTOK: optionalProviderMode,
  METRICS_PROVIDER_INSTAGRAM: optionalProviderMode,
  X_BEARER_TOKEN: optionalString,
  SOCIALDATA_API_KEY: optionalString,
  APIFY_TOKEN: optionalString,
  REFRESH_BATCH_SIZE: optionalPositiveInt,
  ADMIN_USER_IDS: optionalString,
  AUTO_APPROVE_SUBMISSIONS: optionalBooleanString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid server environment:\n${details}\nCopy .env.example to .env.local and fill in real values.`,
  );
}

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
