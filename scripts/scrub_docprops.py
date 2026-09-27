"""One-off: blank author metadata in an .xlsx without touching sheets (keeps Excel's cached values)."""
import re
import shutil
import sys
import zipfile

path = sys.argv[1]
tmp = path + ".tmp"
with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename in ("docProps/core.xml", "docProps/app.xml"):
            s = data.decode("utf-8")
            s = re.sub(r"<(dc:creator|cp:lastModifiedBy|Company|Manager)>[^<]*</\1>", r"<\1></\1>", s)
            data = s.encode("utf-8")
        zout.writestr(item, data)
shutil.move(tmp, path)
print("scrubbed", path)
