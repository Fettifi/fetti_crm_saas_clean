# Fetti Automations

This folder contains all messaging and configuration assets for the Fetti Super Agent:
- States: CA, FL, MI, OH
- Pipelines: Mortgage, DSCR, Hard Money, Fix & Flip
- Follow-up Mode: Fetti Domination (long-term, multi-touch)

## Folder Structure

- sequences/
  - fetti_sms_followup.txt      # SMS cadence
  - fetti_email_followup.txt    # Email cadence
  - fetti_voicemail_scripts.txt # Voicemail drops

- configs/
  - fetti_sequences_config.json # JSON config describing sequences and usage

- scripts/
  - show_structure.sh           # Quick view of this folder and files

- logs/
  - (empty placeholder – use for future automation logs / exports)

You can wire this into any CRM or automation platform by:
1. Reading the config file in configs/fetti_sequences_config.json
2. Loading each corresponding sequence file from sequences/
3. Mapping the messages to your platform's campaign / workflow engine.

