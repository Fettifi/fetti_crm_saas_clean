import fs from "fs";
import path from "path";

type FettiSequenceConfig = {
  version: number;
  brand: string;
  timezone: string;
  states: string[];
  pipelines: string[];
  sequences: {
    sms: { label: string; file: string; channel: string; description: string };
    email: { label: string; file: string; channel: string; description: string };
    voicemail: { label: string; file: string; channel: string; description: string };
  };
};

const ROOT_DIR = process.cwd();
const FETTI_BASE_DIR = path.join(ROOT_DIR, "fetti_automations");
const CONFIG_PATH = path.join(FETTI_BASE_DIR, "configs", "fetti_sequences_config.json");

export function loadFettiConfig(): FettiSequenceConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw) as FettiSequenceConfig;
}

export function loadFettiSequenceText(relativeFilePath: string): string {
  const fullPath = path.join(FETTI_BASE_DIR, relativeFilePath.replace(/^\.?\//, ""));
  return fs.readFileSync(fullPath, "utf8");
}

export function getFettiSequences() {
  const config = loadFettiConfig();

  const smsText = loadFettiSequenceText(config.sequences.sms.file);
  const emailText = loadFettiSequenceText(config.sequences.email.file);
  const voicemailText = loadFettiSequenceText(config.sequences.voicemail.file);

  return {
    config,
    sms: {
      meta: config.sequences.sms,
      text: smsText,
    },
    email: {
      meta: config.sequences.email,
      text: emailText,
    },
    voicemail: {
      meta: config.sequences.voicemail,
      text: voicemailText,
    },
  };
}

export enum LeadStatus {
  NEW = "NEW",
  CONTACTED = "CONTACTED",
  ENGAGED = "ENGAGED",
  DEAD = "DEAD",
  NOT_QUALIFIED = "NOT_QUALIFIED",
}

export interface Lead {
  id?: string;
  name?: string;
  email?: string;
  status: LeadStatus;
  created_at?: string;
}

export const DEFAULT_LEAD_STATUS = LeadStatus.NEW;

export enum ApplicationStatus {
  STARTED = "STARTED",
  IN_PROGRESS = "IN_PROGRESS",
  SUBMITTED = "SUBMITTED",
  INCOMPLETE = "INCOMPLETE",
  WITHDRAWN = "WITHDRAWN",
}

export const DEFAULT_APPLICATION_STATUS = ApplicationStatus.STARTED;
