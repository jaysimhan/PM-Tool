import re

# Remove from WorkloadDashboard.tsx
with open('src/components/WorkloadDashboard.tsx', 'r') as f:
    wl_content = f.read()

# Replace export button
export_btn_tgt = """                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Export
                    </button>"""
wl_content = wl_content.replace(export_btn_tgt, "")

with open('src/components/WorkloadDashboard.tsx', 'w') as f:
    f.write(wl_content)


# Remove from Reports.tsx
with open('src/components/Reports.tsx', 'r') as f:
    rp_content = f.read()

rp_export_tgt = """                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Export
                    </button>"""
rp_content = rp_content.replace(rp_export_tgt, "")

with open('src/components/Reports.tsx', 'w') as f:
    f.write(rp_content)
