#!/bin/bash

# Script to generate missing daily summaries for both default and on-top-of-chromium configurations
# Usage: ./scripts/generate-missing-dailies.sh [start_date] [end_date]
# Example: ./scripts/generate-missing-dailies.sh 2025-11-09 2025-12-18
# If no dates provided, defaults to finding the earliest and latest dates

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default directories
DEFAULT_DIR="public/summaries"
ONTOP_DIR="public/summaries/on-top-of-chromium"
CONFIG_FILE="config.on-top-of-chromium.json"

is_valid_date() {
    date -j -f "%Y-%m-%d" "$1" "+%Y-%m-%d" &>/dev/null
}

# Function to get all dates between two dates
get_date_range() {
    local start_date=$1
    local end_date=$2
    local current_date=$start_date
    
    while [[ "$current_date" < "$end_date" ]] || [[ "$current_date" == "$end_date" ]]; do
        echo "$current_date"
        current_date=$(date -j -v+1d -f "%Y-%m-%d" "$current_date" "+%Y-%m-%d")
    done
}

# Function to find earliest date in a directory
find_earliest_date() {
    local dir=$1
    ls -1 "$dir"/*.html 2>/dev/null | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort | head -n1
}

# Function to get missing dates for a directory
get_missing_dates() {
    local dir=$1
    local start_date=$2
    local end_date=$3
    local missing_dates=()
    
    for date in $(get_date_range "$start_date" "$end_date"); do
        if [[ ! -f "$dir/$date.html" ]]; then
            missing_dates+=("$date")
        fi
    done
    
    echo "${missing_dates[@]}"
}

# Parse command line arguments
START_DATE=${1:-}
END_DATE=${2:-}

# If no dates provided, auto-detect from existing files
if [[ -z "$START_DATE" ]]; then
    echo -e "${YELLOW}No start date provided, detecting from existing files...${NC}"
    DEFAULT_START=$(find_earliest_date "$DEFAULT_DIR")
    ONTOP_START=$(find_earliest_date "$ONTOP_DIR")
    
    # Use the earliest of the two
    if [[ "$DEFAULT_START" < "$ONTOP_START" ]] || [[ -z "$ONTOP_START" ]]; then
        START_DATE=$DEFAULT_START
    else
        START_DATE=$ONTOP_START
    fi
    echo -e "${GREEN}Start date: $START_DATE${NC}"
fi

if [[ -z "$END_DATE" ]]; then
    # Default to yesterday
    END_DATE=$(date -v-1d "+%Y-%m-%d")
    echo -e "${GREEN}End date: $END_DATE (yesterday)${NC}"
fi

# Validate dates
if ! is_valid_date "$START_DATE"; then
    echo -e "${RED}Error: Invalid start date format: $START_DATE${NC}"
    exit 1
fi

if ! is_valid_date "$END_DATE"; then
    echo -e "${RED}Error: Invalid end date format: $END_DATE${NC}"
    exit 1
fi

echo ""
echo "==================================================="
echo "Checking for missing dailies from $START_DATE to $END_DATE"
echo "==================================================="
echo ""

# Find missing dates for default summaries
echo -e "${YELLOW}Checking default summaries...${NC}"
MISSING_DEFAULT=($(get_missing_dates "$DEFAULT_DIR" "$START_DATE" "$END_DATE"))

if [[ ${#MISSING_DEFAULT[@]} -eq 0 ]]; then
    echo -e "${GREEN}✓ No missing default summaries${NC}"
else
    echo -e "${RED}Missing ${#MISSING_DEFAULT[@]} default summaries:${NC}"
    printf '%s\n' "${MISSING_DEFAULT[@]}"
fi

echo ""

# Find missing dates for on-top-of-chromium summaries
echo -e "${YELLOW}Checking on-top-of-chromium summaries...${NC}"
MISSING_ONTOP=($(get_missing_dates "$ONTOP_DIR" "$START_DATE" "$END_DATE"))

if [[ ${#MISSING_ONTOP[@]} -eq 0 ]]; then
    echo -e "${GREEN}✓ No missing on-top-of-chromium summaries${NC}"
else
    echo -e "${RED}Missing ${#MISSING_ONTOP[@]} on-top-of-chromium summaries:${NC}"
    printf '%s\n' "${MISSING_ONTOP[@]}"
fi

echo ""

# Check if .env.local exists
if [[ ! -f ".env.local" ]]; then
    echo -e "${RED}Error: .env.local file not found!${NC}"
    echo "Please create .env.local with necessary environment variables"
    exit 1
fi

# Count total missing
TOTAL_MISSING=$((${#MISSING_DEFAULT[@]} + ${#MISSING_ONTOP[@]}))

if [[ $TOTAL_MISSING -eq 0 ]]; then
    echo -e "${GREEN}All summaries are up to date!${NC}"
    exit 0
fi

# Confirm before proceeding
echo "==================================================="
echo -e "${YELLOW}Total missing summaries: $TOTAL_MISSING${NC}"
echo "==================================================="
echo ""
read -p "Do you want to generate the missing summaries? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "==================================================="
echo "Generating missing summaries..."
echo "==================================================="
echo ""

# Generate missing default summaries
for date in "${MISSING_DEFAULT[@]}"; do
    echo -e "${YELLOW}Generating default summary for $date...${NC}"
    if source .env.local && npm run generate-page -- "$date" main; then
        echo -e "${GREEN}✓ Generated default summary for $date${NC}"
    else
        echo -e "${RED}✗ Failed to generate default summary for $date${NC}"
    fi
    echo ""
done

# Generate missing on-top-of-chromium summaries
for date in "${MISSING_ONTOP[@]}"; do
    echo -e "${YELLOW}Generating on-top-of-chromium summary for $date...${NC}"
    if source .env.local && npm run generate-page -- "$date" main "$CONFIG_FILE"; then
        echo -e "${GREEN}✓ Generated on-top-of-chromium summary for $date${NC}"
    else
        echo -e "${RED}✗ Failed to generate on-top-of-chromium summary for $date${NC}"
    fi
    echo ""
done

echo ""
echo "==================================================="
echo -e "${GREEN}Done!${NC}"
echo "==================================================="
