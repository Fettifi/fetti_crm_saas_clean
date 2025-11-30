import fs from "fs";
import path from "path";

const ROOT_DIR = process.cwd();
const FETTI_BASE_DIR = path.join(ROOT_DIR, "fetti_automations");
const CONFIG_PATH = path.join(FETTI_BASE_DIR, "configs", "fetti_sequences_config.json");

const rawConfig = fs.readFileSync(CONFIG_PATH, "utf8");
const config = JSON.parse(rawConfig);

function loadText(relativePath) {
  const fullPath = path.join(FETTI_BASE_DIR, relativePath.replace(/^\.?\//, ""));
  return fs.readFileSync(fullPath, "utf8");
}

const smsText = loadText(config.sequences.sms.file);
const emailText = loadText(config.sequences.email.file);
const voicemailText = loadText(config.sequences.voicemail.file);

console.log("States:", config.states);
console.log("\n=== SMS SEQUENCE ===\n");
console.log(smsText);
console.log("\n=== EMAIL SEQUENCE ===\n");
console.log(emailText);
console.log("\n=== VOICEMAIL SCRIPTS ===\n");
console.log(voicemailText);
