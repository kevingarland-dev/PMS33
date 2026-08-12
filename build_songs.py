import os
import re
import glob

REPO_SRC = r'C:\Users\kojoe\.gemini\antigravity\scratch\PMS33\scratch_buzzer\src'
FIRMWARE_HEADER = r'C:\Users\kojoe\.gemini\antigravity\scratch\PMS33\firmware\src\songs_library.h'
WEBAPP_JS = r'C:\Users\kojoe\.gemini\antigravity\scratch\PMS33\webapp\js\songs_library.js'

songs = []

for root, dirs, files in os.walk(REPO_SRC):
    for f in files:
        if f.endswith('.ino') and f != 'buzzer.ino':
            filepath = os.path.join(root, f)
            rel_dir = os.path.relpath(root, REPO_SRC)
            category = rel_dir.split(os.sep)[0] if os.sep in rel_dir else rel_dir

            song_id = os.path.splitext(f)[0].lower()
            
            # Format clean title
            raw_title = song_id.replace('_', ' ')
            title = ' '.join(w.capitalize() for w in raw_title.split())
            
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as ino_f:
                content = ino_f.read()
                
            # Extract melody
            mel_match = re.search(r'int\s+melody\s*\[\s*\]\s*=\s*\{([^}]+)\};', content, re.DOTALL)
            dur_match = re.search(r'int\s+(?:durations|noteDurations)\s*\[\s*\]\s*=\s*\{([^}]+)\};', content, re.DOTALL)
            
            if mel_match and dur_match:
                mel_str = mel_match.group(1).strip()
                dur_str = dur_match.group(1).strip()
                
                # Clean up comments and whitespace
                mel_tokens = [t.strip() for t in re.sub(r'//.*', '', mel_str).replace('\n', ' ').split(',') if t.strip()]
                dur_tokens = [t.strip() for t in re.sub(r'//.*', '', dur_str).replace('\n', ' ').split(',') if t.strip()]
                
                if len(mel_tokens) > 0 and len(mel_tokens) == len(dur_tokens):
                    songs.append({
                        'id': song_id,
                        'title': title,
                        'category': category.capitalize(),
                        'melody': mel_tokens,
                        'durations': dur_tokens,
                        'length': len(mel_tokens)
                    })

print(f"Successfully parsed {len(songs)} songs.")

# Sort songs by category and title
songs.sort(key=lambda x: (x['category'], x['title']))

# Generate firmware C++ header
header_content = """#ifndef SONGS_LIBRARY_H
#define SONGS_LIBRARY_H

#include <Arduino.h>
#include "pitches.h"

struct SongDef {
    const char* id;
    const char* title;
    const int* melody;
    const int* durations;
    int length;
};

"""

# Generate C++ arrays for each song
struct_entries = []

for s in songs:
    s_id = s['id']
    mel_arr = ", ".join(s['melody'])
    dur_arr = ", ".join(s['durations'])
    
    header_content += f"const int mel_{s_id}[] PROGMEM = {{ {mel_arr} }};\n"
    header_content += f"const int dur_{s_id}[] PROGMEM = {{ {dur_arr} }};\n\n"
    
    struct_entries.append(f'    {{ "{s_id}", "{s["title"]}", mel_{s_id}, dur_{s_id}, {s["length"]} }}')

header_content += f"const int TOTAL_SONGS = {len(songs)};\n\n"
header_content += "const SongDef SONGS_LIBRARY[] = {\n"
header_content += ",\n".join(struct_entries)
header_content += "\n};\n\n"

header_content += "#endif // SONGS_LIBRARY_H\n"

with open(FIRMWARE_HEADER, 'w', encoding='utf-8') as h_f:
    h_f.write(header_content)

print(f"Wrote {FIRMWARE_HEADER}")

# Generate JS file for WebApp
js_songs = []
for s in songs:
    js_songs.append({
        'id': s['id'],
        'title': s['title'],
        'category': s['category'],
        'duration': f"{max(3, s['length'] // 4)}s"
    })

js_content = f"""/**
 * PMS33 — Songs Library Registry
 * Auto-generated library containing {len(songs)} songs.
 */
export const SONGS_LIBRARY = {js_songs};
"""

with open(WEBAPP_JS, 'w', encoding='utf-8') as j_f:
    j_f.write(js_content)

print(f"Wrote {WEBAPP_JS}")
