// Name tag: a flat single-colour plate with a keyring hole and the name
// engraved into the top. The plate grows with the name; long names are set
// smaller so the tag stays short enough to print quickly. nametag.py passes
// `name` (already validated) and reads the ECHO line back.

name = "Name";
font = "Liberation Sans:style=Bold";
text_size = 10;        // OpenSCAD size: capitals come out about 0.95 x this tall
max_text_mm = 72;      // longer names are set smaller to fit this width
min_text_size = 6;
plate_h = 20;
thickness = 3.2;       // 16 layers at 0.2 mm
depth = 1.2;           // 6 layers, leaving a 2 mm floor
hole_d = 5;
gap = 3.5;             // hole edge to the first letter
right_margin = 4;
corner_r = 3;
preview = false;       // true: dark engraving, for the requester's preview picture

$fn = 64;

m0 = textmetrics(name, size = text_size, font = font);
size = max(min_text_size, min(text_size, text_size * max_text_mm / m0.size.x));
m = textmetrics(name, size = size, font = font);
// Centre the capitals, not the ink box, so every name sits on the same line.
cap = textmetrics("H", size = size, font = font).size.y;
family = fontmetrics(size = size, font = font).font.family;

hole_x = plate_h / 2;
text_x = hole_x + hole_d / 2 + gap;
plate_l = text_x + m.size.x + right_margin;
baseline = (plate_h - cap) / 2;

module outline() {
  hull() {
    translate([hole_x, plate_h / 2]) circle(d = plate_h);
    translate([plate_l - corner_r, corner_r]) circle(r = corner_r);
    translate([plate_l - corner_r, plate_h - corner_r]) circle(r = corner_r);
  }
}
module letters() {
  translate([text_x - m.position.x, baseline])
    text(name, size = size, font = font, halign = "left", valign = "baseline");
}
module tag() {
  difference() {
    linear_extrude(thickness) difference() {
      outline();
      translate([hole_x, plate_h / 2]) circle(d = hole_d);
    }
    translate([0, 0, thickness - depth]) linear_extrude(depth + 1) letters();
  }
}

echo(nametag = [plate_l, plate_h, thickness, size, family]);
if (preview) {
  color("#ece8df") tag();
  color("#2f2f2f") translate([0, 0, thickness - depth]) linear_extrude(0.05) letters();
} else tag();
