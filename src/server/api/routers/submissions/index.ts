import { createTRPCRouter } from "@/server/api/trpc";
import { submit } from "./submit";

export const submissionsRouter = createTRPCRouter({ submit });
