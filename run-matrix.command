#!/bin/zsh
cd ~/Desktop/fetti_crm_saas_clean_fresh

# Make sure Matrix does NOT auto-deploy on its own
unset FETTI_AUTO_DEPLOY

npm run fetti:watch
