# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a SCORM 1.2 compliant e-learning course repository for Abbott's Code of Business Conduct (COBC) 2025 training. The repository contains 33 localized versions of the course, translation source materials, and development resources.

## Repository Structure

### courses/{LANG-CODE}/
Each language version follows this structure:
- `course/` - Deployable SCORM package (HTML, CSS, JS, images)
- `translation/` - Translation source files (HTML templates and flattened course content)

### misc/
- `tables/` - Translation tables for all 33 languages in DOCX and XML formats
- `survey/` - Post-course survey content in XML for select languages
- `x/` - Additional XML source files
- `delivery/` - Course delivery/distribution files
- XML files: Development scripts and course structure definitions

## Supported Languages

The course is available in 33 languages:
- **Arabic**: AR-AE
- **Chinese**: ZH-CN (Simplified), ZH-TW (Traditional)
- **Czech**: CS-CZ
- **Dutch**: NL-NL
- **English**: EN-US (master/source)
- **French**: FR-FR (France), FR-CA (Canada)
- **German**: DE-DE
- **Greek**: EL-GR
- **Gujarati**: GU-IN
- **Hebrew**: HE-IL
- **Hindi**: HI-IN
- **Hmong**: HM-HM
- **Indonesian**: ID-ID
- **Italian**: IT-IT
- **Japanese**: JA-JP
- **Korean**: KO-KR
- **Malay**: MS-MY
- **Norwegian**: NO-NO
- **Polish**: PL-PL
- **Portuguese**: PT-BR (Brazil), PT-PT (Portugal)
- **Russian**: RU-RU
- **Somali**: SO-SO
- **Spanish**: ES-ES (Spain), ES-LA (Latin America)
- **Swahili**: SW-KE
- **Thai**: TH-TH
- **Turkish**: TR-TR
- **Ukrainian**: UK-UA
- **Urdu**: UR-PK
- **Vietnamese**: VI-VN

## Technical Architecture

### SCORM 1.2 Integration
The course implements SCORM 1.2 standard for LMS compatibility:
- **API Wrapper**: `SCORM_12_APIWrapper.js` handles all LMS communication
- **CMI Data Elements**: Tracks lesson status, student info, session time, suspend data, and interactions
- **Launch Method**: Each course includes `launcher.html` and `index.html` entry points

### JavaScript Framework
Custom namespace `lnx` provides the course framework:
- **lnx.init()**: Application entry point (called on window load)
- **lnx.exit()**: Clean shutdown with LMS data commit
- **lnx.scormApi**: LMS communication layer
- **lnx.nav**: Navigation management
- **lnx.audio**: Audio playback control
- **lnx.assessment**: Quiz/assessment functionality
- **lnx.overlayMan**: Modal/overlay management
- **lnx.cache**: Client-side data caching

### Animation & UI
- **GSAP 3.x**: Animation library (gsap.min.js)
- **Custom CSS**: course.css, reset.css, overrides.css
- **Responsive Design**: Window resize handling via lnx.config.onResize()

### File Organization (per language)
```
courses/{LANG-CODE}/
├── course/
│   ├── index.html           # Main course entry
│   ├── launcher.html        # SCORM launcher
│   ├── course.js            # Framework code (~5000+ lines)
│   ├── course.css           # Main styles
│   ├── preload.js           # Image preloader
│   ├── SCORM_12_APIWrapper.js
│   ├── gsap/
│   │   └── gsap.min.js
│   └── images/              # Course assets
└── translation/
    ├── htmlTemplate.html    # Template for translation export
    └── courseFlatExcDuplicates.html  # Flattened translatable content
```

## Translation Workflow

### Source Language
EN-US is the master source. All translations derive from English content.

### Translation Assets
1. **Translation Tables** (misc/tables/):
   - DOCX format: `Abbott_TranslationTable_CoBC_{LANG-CODE}.docx`
   - XML format: `Abbott_TranslationTable_CoBC_{LANG-CODE}_fromDocx.xml`
   - Links XML: `Abbott_TranslationTable_CoBC_{LANG-CODE}_LinksfromDocx.xml`

2. **Development Script**:
   - Source: `misc/ABB-024_CoBC-2025_DevelopmentScript_v1.2.docx`
   - XML: `misc/ABB-024_CoBC-2025_DevelopmentScript_v1.2_fromDocx.xml`

### Translation Process
1. Export translatable strings from EN-US course
2. Populate translation tables (DOCX)
3. Convert DOCX to XML (likely using DocxXmlRoundTrip.exe tool)
4. Import XML translations into target language course files
5. Test SCORM package in target language

## Common Development Tasks

### View a Course Locally
Open the course directly in a browser:
```bash
# Example: View English course
open courses/EN-US/course/index.html
# or
open courses/EN-US/course/launcher.html
```

Note: SCORM API calls will fail outside an LMS, but course content will display. The framework checks `lnx.config.ignoreLMS` flag.

### Test Course in Different Languages
Navigate to any language folder and open the course:
```bash
# Example: View Spanish (Spain) version
open courses/ES-ES/course/index.html
```

### Compare Translations
Use the flattened HTML files to compare translations:
```bash
# View all translatable text for a language
open courses/{LANG-CODE}/translation/courseFlatExcDuplicates.html
```

### Check Translation Table
Review or edit translation tables in misc/tables/:
```bash
# DOCX files can be opened in Word
open "misc/tables/Abbott_TranslationTable_CoBC_ES-ES.docx"
```

### Deploy a Course Package
Each `courses/{LANG-CODE}/course/` directory is a complete, deployable SCORM 1.2 package:
1. Zip the entire `course/` folder
2. Upload to LMS as SCORM 1.2 package
3. LMS will recognize launcher.html or index.html as entry point

## Important Notes

### No Build Process
This is a static HTML/CSS/JS project with no build step. Courses are deployed as-is from the `course/` directories.

### SCORM Compliance
- **Version**: SCORM 1.2 (not 2004)
- **Required Files**: Each course must include SCORM_12_APIWrapper.js and imsmanifest.xml (if present)
- **LMS Testing**: Always test in target LMS before deployment

### Code Modifications
When modifying course.js or course.css:
1. Make changes to EN-US first
2. Verify functionality in EN-US course
3. Replicate changes to all other language versions
4. Be cautious: course.js exceeds 5000 lines - changes affect all languages

### Translation Integrity
- Maintain HTML structure in translations (don't break tags)
- Preserve special characters and entities
- Keep hyperlinks intact (tracked in LinksfromDocx.xml files)
- Test RTL languages (AR-AE, HE-IL, UR-PK) for layout issues

### Asset Management
- Images are shared across languages (same visual content)
- Audio files (if any) are language-specific and stored per language folder
- CSS overrides can be language-specific (overrides.css)

### Version Control
- Git repository initialized (no .gitignore currently)
- Consider adding .gitignore to exclude large ZIP archives in misc/
- Commit messages are currently minimal - improve for clarity

## Course Content

Abbott's Code of Business Conduct covers:
- Patients, consumers, and healthcare professionals
- Product quality, safety, and promotion
- Scientific research and innovation
- Workplace culture, diversity, and respect
- Anti-bribery, compliance, and fair competition
- Confidential information and data privacy
- Accurate record-keeping and legal compliance

This is regulatory compliance training - maintain accuracy and consistency across all languages.
