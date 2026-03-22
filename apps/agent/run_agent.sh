#!/bin/bash

# Load environment variables
source .env

# Activate Python 3.12 virtual environment and run agent
source .venv312/bin/activate
python main.py dev