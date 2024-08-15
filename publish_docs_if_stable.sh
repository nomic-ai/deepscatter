#!/bin/bash

# Extract version from package.json
VERSION=$(node -p "require('./package.json').version")

# Check if this is a pre-release version (it will contain a '-')
if [[ $VERSION == *"-"* ]]; then
  echo "Pre-release version detected. Skipping documentation publish."
  exit 0
fi

# Build the project
vite build && tsc || true

# Generate documentation
typedoc --skipErrorChecking src/* 

# Switch to the gh-pages branch
git checkout gh-pages

# Copy the generated documentation to the branch
cp -R ./docs/* ./ 

# Commit and push the changes
git add .
git commit -m "Update documentation for $VERSION"
git push origin gh-pages

# Switch back to the original branch
git checkout -
