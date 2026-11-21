# Mobile Sonar dependency analysis warnings — Plan

1. Export the committed Android release runtime lock, native module's explicit pins, and CI PyYAML pin to a CycloneDX SBOM; reject unsupported input without invoking Gradle or Pip.
2. Import the SBOM only in trusted main analysis, exclude the three reported manifests from direct resolution, and preserve both no-resolve settings and protected PR SCA disablement.
3. Run generator and protected workflow tests, then follow CI and review gates. After an approved merge, run the main scan and confirm the warnings are gone and the SBOM packages appear.
