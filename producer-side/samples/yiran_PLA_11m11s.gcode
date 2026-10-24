; HEADER_BLOCK_START
; BambuStudio 02.08.02.60
; model printing time: 5m 13s; total estimated time: 11m 11s
; total layer number: 15
; total filament length [mm] : 630.70
; total filament volume [cm^3] : 1517.01
; total filament weight [g] : 1.91
; filament_density: 1.26,1.25,1.26,1.32
; filament_diameter: 1.75,1.75,1.75,1.75
; max_z_height: 3.00
; filament: 1
; support_material_on_wipe_tower: 0
; HEADER_BLOCK_END

; CONFIG_BLOCK_START
; accel_to_decel_enable = 0
; accel_to_decel_factor = 50%
; activate_air_filtration = 0,0,0,0
; additional_cooling_fan_speed = 70,0,70,70
; additional_fan_full_speed_layer = 0,0,0,0
; alternate_extra_wall = 0
; ams_filament_load_time_ams = 0
; ams_filament_load_time_ams_lite = 0
; ams_filament_load_time_n3f_s = 0
; ams_filament_unload_time_ams = 0
; ams_filament_unload_time_ams_lite = 0
; ams_filament_unload_time_n3f_s = 0
; apply_scarf_seam_on_circles = 1
; auxiliary_fan = 0
; avoid_crossing_wall_includes_support = 0
; bed_custom_model = 
; bed_custom_texture = 
; bed_exclude_area = 
; bed_heat_soak_area = 
; bed_temperature_formula = by_first_filament
; before_layer_change_gcode = 
; best_object_pos = 0.7,0.5
; bottom_color_penetration_layers = 3
; bottom_shell_layers = 3
; bottom_shell_thickness = 0
; bottom_surface_density = 100%
; bottom_surface_pattern = monotonic
; bridge_angle = 0
; bridge_flow = 1
; bridge_no_support = 0
; bridge_speed = 50
; brim_object_gap = 0.1
; brim_type = auto_brim
; brim_width = 5
; chamber_temperatures = 0,0,0,0
; change_filament_gcode = ;===== A1mini 20251031 =====\nG392 S0\nM1007 S0\nM620 S[next_extruder]A\nM204 S9000\nG1 Z{max_layer_z + 3.0} F1200\n\nM400\nM106 P1 S0\nM106 P2 S0\n{if old_filament_temp > 142 && next_extruder < 255}\nM104 S[old_filament_temp]\n{endif}\n\nG1 X180 F18000\n\n{if long_retractions_when_cut[previous_extruder]}\nM620.11 S1 I[previous_extruder] E-{retraction_distances_when_cut[previous_extruder]} F1200\n{else}\nM620.11 S0\n{endif}\nM400\n\nM620.1 E F{flush_volumetric_speeds[previous_extruder]/2.4053*60} T{flush_temperatures[previous_extruder]}\nM620.10 A0 F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\nT[next_extruder]\nM620.1 E F{flush_volumetric_speeds[next_extruder]/2.4053*60} T{flush_temperatures[next_extruder]}\nM620.10 A1 F{flush_volumetric_speeds[next_extruder]/2.4053*60} L[flush_length] H[nozzle_diameter] T{flush_temperatures[next_extruder]}\n\nG1 Y90 F9000\n\n{if next_extruder < 255}\n\n{if long_retractions_when_cut[previous_extruder]}\nM620.11 S1 I[previous_extruder] E{retraction_distances_when_cut[previous_extruder]} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\nM628 S1\nG92 E0\nG1 E{retraction_distances_when_cut[previous_extruder]} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\nM400\nM629 S1\n{else}\nM620.11 S0\n{endif}\n\nM400\nG92 E0\nM628 S0\n\n{if flush_length_1 > 1}\n; FLUSH_START\n; always use highest temperature to flush\nM400\nM1002 set_filament_type:UNKNOWN\nM109 S[flush_temperatures[next_extruder]]\nM106 P1 S60\n{if flush_length_1 > 23.7}\nG1 E23.7 F{flush_volumetric_speeds[previous_extruder]/2.4053*60} ; do not need pulsatile flushing for start part\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\n{else}\nG1 E{flush_length_1} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\n{endif}\n; FLUSH_END\nG1 E-[old_retract_length_toolchange] F1800\nG1 E[old_retract_length_toolchange] F300\nM400\nM1002 set_filament_type:{filament_type[next_extruder]}\n{endif}\n\n{if flush_length_1 > 45 && flush_length_2 > 1}\n; WIPE\nM400\nM106 P1 S178\nM400 S3\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nM400\nM106 P1 S0\n{endif}\n\n{if flush_length_2 > 1}\nM106 P1 S60\n; FLUSH_START\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\n; FLUSH_END\nG1 E-[new_retract_length_toolchange] F1800\nG1 E[new_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_2 > 45 && flush_length_3 > 1}\n; WIPE\nM400\nM106 P1 S178\nM400 S3\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nM400\nM106 P1 S0\n{endif}\n\n{if flush_length_3 > 1}\nM106 P1 S60\n; FLUSH_START\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\n; FLUSH_END\nG1 E-[new_retract_length_toolchange] F1800\nG1 E[new_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_3 > 45 && flush_length_4 > 1}\n; WIPE\nM400\nM106 P1 S178\nM400 S3\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nM400\nM106 P1 S0\n{endif}\n\n{if flush_length_4 > 1}\nM106 P1 S60\n; FLUSH_START\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\n; FLUSH_END\n{endif}\n\nM629\n\nM400\nM106 P1 S60\nM109 S[new_filament_temp]\nG1 E5 F{flush_volumetric_speeds[next_extruder]/2.4053*60} ;Compensate for filament spillage during waiting temperature\nM400\nG92 E0\nG1 E-[new_retract_length_toolchange] F1800\nM400\nM106 P1 S178\nM400 S3\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nG1 X-3.5 F18000\nG1 X-13.5 F3000\nM400\nG1 Z{max_layer_z + 3.0} F3000\nM106 P1 S0\n{if layer_z <= (initial_layer_print_height + 0.001)}\nM204 S[initial_layer_acceleration]\n{else}\nM204 S[default_acceleration]\n{endif}\n{else}\nG1 X[x_after_toolchange] Y[y_after_toolchange] Z[z_after_toolchange] F12000\n{endif}\n\nM622.1 S0\nM9833 F{outer_wall_volumetric_speed/2.4} A0.3 ; cali dynamic extrusion compensation\nM1002 judge_flag filament_need_cali_flag\nM622 J1\n  G92 E0\n  G1 E-[new_retract_length_toolchange] F1800\n  M400\n  \n  M106 P1 S178\n  M400 S7\n  G1 X0 F18000\n  G1 X-13.5 F3000\n  G1 X0 F18000 ;wipe and shake\n  G1 X-13.5 F3000\n  G1 X0 F12000 ;wipe and shake\n  G1 X-13.5 F3000\n  G1 X0 F12000 ;wipe and shake\n  M400\n  M106 P1 S0 \nM623\n\nM621 S[next_extruder]A\nG392 S0\n\nM1007 S1\n
; circle_compensation_manual_offset = 0
; circle_compensation_speed = 200,200,200,200
; close_additional_fan_first_x_layers = 1,3,1,1
; close_fan_the_first_x_layers = 1,3,1,1
; complete_print_exhaust_fan_speed = 70,70,70,70
; cool_plate_temp = 35,0,35,35
; cool_plate_temp_initial_layer = 35,0,35,35
; cooling_filter_enabled = 0
; cooling_perimeter_transition_distance = 10,10,10,10
; cooling_slowdown_logic = uniform_cooling,uniform_cooling,uniform_cooling,uniform_cooling
; counter_coef_1 = 0,0,0,0
; counter_coef_2 = 0.008,0.008,0.008,0.008
; counter_coef_3 = -0.041,-0.041,-0.041,-0.041
; counter_limit_max = 0.033,0.033,0.033,0.033
; counter_limit_min = -0.035,-0.035,-0.035,-0.035
; counterbore_hole_bridging = none
; curr_bed_type = Textured PEI Plate
; default_acceleration = 6000
; default_ams_type = -1
; default_filament_colour = ;;;
; default_filament_profile = "Bambu PLA Basic @BBL A1M"
; default_jerk = 0
; default_nozzle_volume_type = Standard
; default_print_profile = 0.20mm Standard @BBL A1M
; deretraction_speed = 30
; detect_floating_vertical_shell = 1
; detect_narrow_internal_solid_infill = 1
; detect_overhang_wall = 1
; detect_thin_wall = 0
; diameter_limit = 50,50,50,50
; draft_shield = disabled
; during_print_exhaust_fan_speed = 70,70,70,70
; elefant_foot_compensation = 0
; embedding_wall_into_infill = 0
; enable_arc_fitting = 1
; enable_circle_compensation = 0
; enable_filament_dynamic_map = 0
; enable_height_slowdown = 0
; enable_long_retraction_when_cut = 2
; enable_mixed_color_sublayer = 0
; enable_order_independent_overlap_carving = 0
; enable_overhang_bridge_fan = 1,1,1,1
; enable_overhang_speed = 1
; enable_pre_heating = 0
; enable_pressure_advance = 0,0,0,0
; enable_prime_tower = 0
; enable_support = 0
; enable_support_ironing = 0
; enable_tower_interface_features = 0
; enable_wrapping_detection = 0
; enforce_support_layers = 0
; eng_plate_temp = 0,70,0,0
; eng_plate_temp_initial_layer = 0,70,0,0
; ensure_vertical_shell_thickness = enabled
; exclude_object = 1
; extruder_ams_count = 1#0|4#0;1#0|4#0
; extruder_clearance_dist_to_rod = 56.5
; extruder_clearance_height_to_lid = 180
; extruder_clearance_height_to_rod = 25
; extruder_clearance_max_radius = 73
; extruder_colour = #018001
; extruder_max_nozzle_count = 1
; extruder_nozzle_stats = Standard#1
; extruder_nozzle_stats_new = 
; extruder_offset = 0x0
; extruder_printable_area = 
; extruder_type = Direct Drive
; extruder_variant_list = "Direct Drive Standard"
; fan_cooling_layer_time = 80,30,80,80
; fan_direction = undefine
; fan_max_speed = 80,50,80,80
; fan_min_speed = 60,30,60,60
; farthest_point_timelapse = 0
; filament_adaptive_volumetric_speed = 0,0,0,0
; filament_adhesiveness_category = 100,300,100,100
; filament_bridge_speed = 25,25,25,25
; filament_change_length = 5,10,5,10
; filament_change_length_nc = 10,10,10,10
; filament_colour = #000000;#C1C1C1;#161616;#0EE2A0
; filament_colour_type = 0;;;
; filament_cooling_before_tower = 0,0,0,0
; filament_cost = 19.99,17.99,19.99,19.99
; filament_density = 1.26,1.25,1.26,1.32
; filament_dev_ams_drying_ams_limitations = 1;0;1;0;1;0;1;0
; filament_dev_ams_drying_heat_distortion_temperature = 45,75,45,45
; filament_dev_ams_drying_temperature = 45,45,45,45,65,65,55,55,45,45,45,45,45,45,45,45
; filament_dev_ams_drying_time = 12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12
; filament_dev_chamber_drying_bed_temperature = 70,80,70,70
; filament_dev_chamber_drying_time = 12,12,12,12
; filament_dev_drying_cooling_temperature = 45,55,45,45
; filament_dev_drying_softening_temperature = 50,60,50,50
; filament_diameter = 1.75,1.75,1.75,1.75
; filament_enable_overhang_speed = 1,1,1,1
; filament_end_gcode = "; filament end gcode \n\n";"; filament end gcode \n\n";"; filament end gcode \n\n";"; filament end gcode \n\n"
; filament_extruder_compatibility = 0,0,0,0
; filament_extruder_variant = "Direct Drive Standard";"Direct Drive Standard";"Direct Drive Standard";"Direct Drive Standard"
; filament_flow_ratio = 0.98,0.94,0.98,0.98
; filament_flush_temp = 0,0,0,0
; filament_flush_temp_fast = 0,0,0,0
; filament_flush_volumetric_speed = 0,0,0,0
; filament_ids = GFA00;GFG00;GFA00;GFA01
; filament_is_mixed = 0,0,0,0
; filament_is_support = 0,0,0,0
; filament_long_retractions_when_cut = 1,1,1,1
; filament_map = 1,1,1,1
; filament_map_2 = 0,0,0,0
; filament_map_mode = Auto For Flush
; filament_max_volumetric_speed = 21,13,21,22
; filament_metal_stickiness = None,High,None,None
; filament_minimal_purge_on_wipe_tower = 15,15,15,15
; filament_mixed_components = ""
; filament_mixed_gradient = 0,0,0,0
; filament_mixed_gradient_curve = ;;;
; filament_mixed_gradient_per_part = 0,0,0,0
; filament_mixed_gradient_range = ""
; filament_mixed_sublayer_ratios = ""
; filament_multi_colour = #000000;#C1C1C1;#161616;#0EE2A0
; filament_notes = 
; filament_nozzle_map = 0,0,0,0
; filament_overhang_1_4_speed = 0,0,0,0
; filament_overhang_2_4_speed = 50,50,50,50
; filament_overhang_3_4_speed = 30,30,30,30
; filament_overhang_4_4_speed = 10,10,10,10
; filament_overhang_totally_speed = 10,10,10,10
; filament_pre_cooling_temperature = 0,0,0,0
; filament_pre_cooling_temperature_nc = 0,0,0,0
; filament_preheat_temperature_delta = 0,0,0,0
; filament_prime_volume = 30,45,30,45
; filament_prime_volume_nc = 60,60,60,60
; filament_printable = 3,3,3,3
; filament_ramming_travel_time = 0,0,0,0
; filament_ramming_travel_time_nc = 0,0,0,0
; filament_ramming_volumetric_speed = -1,-1,-1,-1
; filament_ramming_volumetric_speed_nc = -1,-1,-1,-1
; filament_retract_length_nc = 14,14,14,14
; filament_retraction_distances_when_cut = 18,18,18,18
; filament_retraction_length = nil,0.4,nil,nil
; filament_scarf_gap = 0%,0%,0%,0%
; filament_scarf_height = 10%,10%,10%,5%
; filament_scarf_length = 10,10,10,10
; filament_scarf_seam_type = none,none,none,none
; filament_self_index = 1,2,3,4
; filament_settings_id = "Bambu PLA Basic @BBL A1M";"Bambu PETG Basic @BBL A1M 0.4 nozzle";"Bambu PLA Basic @BBL A1M";"Bambu PLA Matte @BBL A1M"
; filament_shrink = 100%,100%,100%,100%
; filament_soluble = 0,0,0,0
; filament_start_gcode = "; filament start gcode\n{if  (bed_temperature[current_extruder] >55)||(bed_temperature_initial_layer[current_extruder] >55)}M106 P3 S200\n{elsif(bed_temperature[current_extruder] >50)||(bed_temperature_initial_layer[current_extruder] >50)}M106 P3 S150\n{elsif(bed_temperature[current_extruder] >45)||(bed_temperature_initial_layer[current_extruder] >45)}M106 P3 S50\n{endif}\n\n{if activate_air_filtration[current_extruder] && support_air_filtration}\nM106 P3 S{during_print_exhaust_fan_speed_num[current_extruder]} \n{endif}";"; filament start gcode\n{if (bed_temperature[current_extruder] >80)||(bed_temperature_initial_layer[current_extruder] >80)}M106 P3 S255\n{elsif (bed_temperature[current_extruder] >60)||(bed_temperature_initial_layer[current_extruder] >60)}M106 P3 S180\n{endif}\n\n{if activate_air_filtration[current_extruder] && support_air_filtration}\nM106 P3 S{during_print_exhaust_fan_speed_num[current_extruder]} \n{endif}";"; filament start gcode\n{if  (bed_temperature[current_extruder] >55)||(bed_temperature_initial_layer[current_extruder] >55)}M106 P3 S200\n{elsif(bed_temperature[current_extruder] >50)||(bed_temperature_initial_layer[current_extruder] >50)}M106 P3 S150\n{elsif(bed_temperature[current_extruder] >45)||(bed_temperature_initial_layer[current_extruder] >45)}M106 P3 S50\n{endif}\n\n{if activate_air_filtration[current_extruder] && support_air_filtration}\nM106 P3 S{during_print_exhaust_fan_speed_num[current_extruder]} \n{endif}";"; filament start gcode\n{if  (bed_temperature[current_extruder] >55)||(bed_temperature_initial_layer[current_extruder] >55)}M106 P3 S200\n{elsif(bed_temperature[current_extruder] >50)||(bed_temperature_initial_layer[current_extruder] >50)}M106 P3 S150\n{elsif(bed_temperature[current_extruder] >45)||(bed_temperature_initial_layer[current_extruder] >45)}M106 P3 S50\n{endif}\n\n{if activate_air_filtration[current_extruder] && support_air_filtration}\nM106 P3 S{during_print_exhaust_fan_speed_num[current_extruder]} \n{endif}"
; filament_tower_interface_pre_extrusion_dist = 10,10,10,10
; filament_tower_interface_pre_extrusion_length = 0,0,0,0
; filament_tower_interface_print_temp = -1,-1,-1,-1
; filament_tower_interface_purge_volume = 20,20,20,20
; filament_tower_ironing_area = 4,4,4,4
; filament_type = PLA;PETG;PLA;PLA
; filament_velocity_adaptation_factor = 1,1,1,1
; filament_vendor = "Bambu Lab";"Bambu Lab";"Bambu Lab";"Bambu Lab"
; filament_volume_map = 0,0,0,0
; filament_wipe = nil,1,nil,nil
; filament_wipe_distance = nil,1,nil,nil
; filament_z_hop_types = nil,Spiral Lift,nil,nil
; filename_format = {input_filename_base}_{filament_type[0]}_{print_time}.gcode
; fill_multiline = 1
; filter_out_gap_fill = 0
; first_layer_print_sequence = 0
; first_x_layer_fan_speed = 0,0,0,0
; first_x_layer_part_fan_speed = 0,0,0,0
; flush_into_infill = 0
; flush_into_objects = 0
; flush_into_support = 1
; flush_multiplier = 1
; flush_multiplier_fast = 1.2
; flush_volumes_matrix = 0,650,148,566,650,0,650,245,108,650,0,528,148,342,155,0
; flush_volumes_vector = 140,140,140,140,140,140,140,140
; full_fan_speed_layer = 0,0,0,0
; fuzzy_skin = none
; fuzzy_skin_first_layer = 0
; fuzzy_skin_mode = displacement
; fuzzy_skin_noise_type = classic
; fuzzy_skin_octaves = 4
; fuzzy_skin_persistence = 0.5
; fuzzy_skin_point_distance = 0.8
; fuzzy_skin_scale = 1
; fuzzy_skin_thickness = 0.3
; gap_infill_speed = 250
; gcode_add_line_number = 0
; gcode_flavor = marlin
; grab_length = 17.4
; group_algo_with_time = 0
; has_filament_switcher = 0
; has_scarf_joint_seam = 0
; head_wrap_detect_zone = 156x152,180x152,180x180,156x180
; hole_coef_1 = 0,0,0,0
; hole_coef_2 = -0.008,-0.008,-0.008,-0.008
; hole_coef_3 = 0.23415,0.23415,0.23415,0.23415
; hole_limit_max = 0.22,0.22,0.22,0.22
; hole_limit_min = 0.088,0.088,0.088,0.088
; host_type = octoprint
; hot_plate_temp = 60,70,60,60
; hot_plate_temp_initial_layer = 60,70,60,60
; hotend_cooling_rate = 2
; hotend_heating_rate = 2
; impact_strength_z = 13.8,13.6,13.8,6.6
; independent_support_layer_height = 1
; infill_combination = 0
; infill_direction = 45
; infill_instead_top_bottom_surfaces = 0
; infill_jerk = 9
; infill_lock_depth = 1
; infill_rotate_step = 0
; infill_shift_step = 0.4
; infill_wall_overlap = 15%
; initial_layer_acceleration = 500
; initial_layer_flow_ratio = 1
; initial_layer_infill_speed = 105
; initial_layer_jerk = 9
; initial_layer_line_width = 0.5
; initial_layer_print_height = 0.2
; initial_layer_speed = 50
; initial_layer_travel_acceleration = 6000
; inner_wall_acceleration = 0
; inner_wall_jerk = 9
; inner_wall_line_width = 0.45
; inner_wall_speed = 300
; interface_shells = 0
; interlocking_beam = 0
; interlocking_beam_layer_count = 2
; interlocking_beam_width = 0.8
; interlocking_boundary_avoidance = 2
; interlocking_depth = 2
; interlocking_orientation = 22.5
; internal_bridge_support_thickness = 0.8
; internal_solid_infill_line_width = 0.42
; internal_solid_infill_pattern = zig-zag
; internal_solid_infill_speed = 250
; ironing_direction = 45
; ironing_fan_speed = -1,-1,-1,-1
; ironing_flow = 10%
; ironing_inset = 0.21
; ironing_pattern = zig-zag
; ironing_spacing = 0.15
; ironing_speed = 30
; ironing_type = no ironing
; is_infill_first = 0
; layer_change_gcode = ; layer num/total_layer_count: {layer_num+1}/[total_layer_count]\n; update layer progress\nM73 L{layer_num+1}\nM991 S0 P{layer_num} ;notify layer change
; layer_height = 0.2
; line_width = 0.42
; locked_skeleton_infill_pattern = zigzag
; locked_skin_infill_pattern = crosszag
; long_retractions_when_cut = 0
; long_retractions_when_ec = 0,0,0,0
; machine_bed_mass_Y = 0
; machine_end_gcode = ;===== date: 20260513 =====================\n;turn off nozzle clog detect\nG392 S0\n\nM400 ; wait for buffer to clear\nG92 E0 ; zero the extruder\nG90\nG1 Z{max_layer_z + 0.4} F900 ; lower z a little\nG1 X0 Y{first_layer_center_no_wipe_tower[1]} F18000 ; move to safe pos\nG1 X-13.0 F3000 ; move to safe pos\n{if !spiral_mode && print_sequence != \"by object\"}\nM1002 judge_flag timelapse_record_flag\nM622 J1\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM400 P100\nM971 S11 C11 O0\nM991 S0 P-1 ;end timelapse at safe pos\nM623\n{endif}\n\nM140 S0 ; turn off bed\nM106 S0 ; turn off fan\nM106 P2 S0 ; turn off remote part cooling fan\nM106 P3 S0 ; turn off chamber cooling fan\n\n;G1 X27 F15000 ; wipe\n\n; pull back filament to AMS\nM620 S255\nG1 X181 F12000\nT255\nG1 X0 F18000\nG1 X-13.0 F3000\nG1 X0 F18000 ; wipe\nM621 S255\n\nM104 S0 ; turn off hotend\n\nM400 ; wait all motion done\nM17 S\nM17 Z0.4 ; lower z motor current to reduce impact if there is something in the bottom\n{if (max_layer_z + 100.0) < 180}\n    G1 Z{max_layer_z + 100.0} F600\n    G1 Z{max_layer_z +98.0}\n{else}\n    G1 Z180 F600\n    G1 Z180\n{endif}\nM400 P100\nM17 R ; restore z current\n\nG90\nG1 X-13 Y180 F3600\n\nG91\nG1 Z-1 F600\nG90\nM83\n\nM220 S100  ; Reset feedrate magnitude\nM201.2 K1.0 ; Reset acc magnitude\nM73.2   R1.0 ;Reset left time magnitude\nM1002 set_gcode_claim_speed_level : 0\n\n;=====printer finish  sound=========\nM17\nM400 S1\nM1006 S1\nM1006 A0 B20 L100 C37 D20 M100 E42 F20 N100\nM1006 A0 B10 L100 C44 D10 M100 E44 F10 N100\nM1006 A0 B10 L100 C46 D10 M100 E46 F10 N100\nM1006 A44 B20 L100 C39 D20 M100 E48 F20 N100\nM1006 A0 B10 L100 C44 D10 M100 E44 F10 N100\nM1006 A0 B10 L100 C0 D10 M100 E0 F10 N100\nM1006 A0 B10 L100 C39 D10 M100 E39 F10 N100\nM1006 A0 B10 L100 C0 D10 M100 E0 F10 N100\nM1006 A0 B10 L100 C44 D10 M100 E44 F10 N100\nM1006 A0 B10 L100 C0 D10 M100 E0 F10 N100\nM1006 A0 B10 L100 C39 D10 M100 E39 F10 N100\nM1006 A0 B10 L100 C0 D10 M100 E0 F10 N100\nM1006 A44 B10 L100 C0 D10 M100 E48 F10 N100\nM1006 A0 B10 L100 C0 D10 M100 E0 F10 N100\nM1006 A44 B20 L100 C41 D20 M100 E49 F20 N100\nM1006 A0 B20 L100 C0 D20 M100 E0 F20 N100\nM1006 A0 B20 L100 C37 D20 M100 E37 F20 N100\nM1006 W\n;=====printer finish  sound=========\nM400 S1\nM18 X Y Z\n
; machine_hotend_change_time = 0
; machine_load_filament_time = 28
; machine_max_acceleration_e = 5000,5000
; machine_max_acceleration_extruding = 20000,20000
; machine_max_acceleration_retracting = 5000,5000
; machine_max_acceleration_travel = 9000,9000
; machine_max_acceleration_x = 20000,20000
; machine_max_acceleration_y = 20000,20000
; machine_max_acceleration_z = 1500,1500
; machine_max_force_Y = 0
; machine_max_jerk_e = 3,3
; machine_max_jerk_x = 9,9
; machine_max_jerk_y = 9,9
; machine_max_jerk_z = 5,5
; machine_max_printed_mass = 0
; machine_max_speed_e = 30,30
; machine_max_speed_x = 500,200
; machine_max_speed_y = 500,200
; machine_max_speed_z = 30,30
; machine_min_extruding_rate = 0,0
; machine_min_travel_rate = 0,0
; machine_pause_gcode = M400 U1
; machine_prepare_compensation_time = 260
; machine_start_gcode = ;===== machine: A1 mini =========================\n;===== date: 20260513 ==================\n\n;===== start to heat heatbead&hotend==========\nM1002 gcode_claim_action : 2\nM1002 set_filament_type:{filament_type[initial_no_support_extruder]}\nM104 S170\nM140 S[bed_temperature_initial_layer_single]\nG392 S0 ;turn off clog detect\nM9833.2\n;=====start printer sound ===================\nM17\nM400 S1\nM1006 S1\nM1006 A0 B0 L100 C37 D10 M100 E37 F10 N100\nM1006 A0 B0 L100 C41 D10 M100 E41 F10 N100\nM1006 A0 B0 L100 C44 D10 M100 E44 F10 N100\nM1006 A0 B10 L100 C0 D10 M100 E0 F10 N100\nM1006 A43 B10 L100 C39 D10 M100 E46 F10 N100\nM1006 A0 B0 L100 C0 D10 M100 E0 F10 N100\nM1006 A0 B0 L100 C39 D10 M100 E43 F10 N100\nM1006 A0 B0 L100 C0 D10 M100 E0 F10 N100\nM1006 A0 B0 L100 C41 D10 M100 E41 F10 N100\nM1006 A0 B0 L100 C44 D10 M100 E44 F10 N100\nM1006 A0 B0 L100 C49 D10 M100 E49 F10 N100\nM1006 A0 B0 L100 C0 D10 M100 E0 F10 N100\nM1006 A44 B10 L100 C39 D10 M100 E48 F10 N100\nM1006 A0 B0 L100 C0 D10 M100 E0 F10 N100\nM1006 A0 B0 L100 C39 D10 M100 E44 F10 N100\nM1006 A0 B0 L100 C0 D10 M100 E0 F10 N100\nM1006 A43 B10 L100 C39 D10 M100 E46 F10 N100\nM1006 W\nM18\n;=====avoid end stop =================\nG91\nG380 S2 Z30 F1200\nG380 S3 Z-20 F1200\nG1 Z5 F1200\nG90\n\n;===== reset machine status =================\nM204 S6000\n\nM630 S0 P0\nG91\nM17 Z0.3 ; lower the z-motor current\n\nG90\nM17 X0.7 Y0.9 Z0.5 ; reset motor current to default\nM960 S5 P1 ; turn on logo lamp\nG90\nM83\nM220 S100 ;Reset Feedrate\nM221 S100 ;Reset Flowrate\nM73.2   R1.0 ;Reset left time magnitude\n;====== cog noise reduction=================\nM982.2 S1 ; turn on cog noise reduction\n\n;===== prepare print temperature and material ==========\nM400\nM18\nM109 S100 H170\nM104 S170\nM400\nM17\nM400\nG28 X\n\nM211 X0 Y0 Z0 ;turn off soft endstop ; turn off soft endstop to prevent protential logic problem\n\nM975 S1 ; turn on\n\nG1 X0.0 F30000\nG1 X-13.5 F3000\n\nM620 M ;enable remap\nM620 S[initial_no_support_extruder]A   ; switch material if AMS exist\n    G392 S0 ;turn on clog detect\n    M1002 gcode_claim_action : 4\n    M400\n    M1002 set_filament_type:UNKNOWN\n    M109 S[nozzle_temperature_initial_layer]\n{if (filament_type[initial_no_support_extruder] == \"PLA\") && (nozzle_diameter != 0.2)}\n    M104 S220\n{else}\n    M104 S250\n{endif}\n    M400\n    T[initial_no_support_extruder]\n    G1 X-13.5 F3000\n    M400\n{if (filament_type[initial_no_support_extruder] == \"PLA\") && (nozzle_diameter != 0.2)}\n    M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} T220\n    M109 S220 ;set nozzle to common flush temp\n{else}\n    M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} T{flush_temperatures[initial_no_support_extruder]}\n    M109 S250 ;set nozzle to common flush temp\n{endif}\n    M106 P1 S0\n    G92 E0\n    G1 E50 F200\n    M400\n    M1002 set_filament_type:{filament_type[initial_no_support_extruder]}\n{if (filament_type[initial_no_support_extruder] == \"PLA\") && (nozzle_diameter != 0.2)}\n    M104 S220\n{else}\n    M104 S{flush_temperatures[initial_no_support_extruder]}\n{endif}\n    G92 E0\n    G1 E50 F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60}\n    M400\n    M106 P1 S178\n    G92 E0\n    G1 E5 F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60}\n    M109 S{nozzle_temperature_initial_layer[initial_no_support_extruder]-20} ; drop nozzle temp, make filament shink a bit\n    M104 S{nozzle_temperature_initial_layer[initial_no_support_extruder]-40}\n    G92 E0\n    G1 E-0.5 F300\n\n    G1 X0 F30000\n    G1 X-13.5 F3000\n    G1 X0 F30000 ;wipe and shake\n    G1 X-13.5 F3000\n    G1 X0 F12000 ;wipe and shake\n    G1 X0 F30000\n    G1 X-13.5 F3000\n    M109 S{nozzle_temperature_initial_layer[initial_no_support_extruder]-40}\n    G392 S0 ;turn off clog detect\nM621 S[initial_no_support_extruder]A\n\nM400\nM106 P1 S0\n;===== prepare print temperature and material end =====\n\n\n;===== mech mode fast check============================\nM1002 gcode_claim_action : 3\nG0 X25 Y175 F20000 ; find a soft place to home\n;M104 S0\nG28 Z P0 T300; home z with low precision,permit 300deg temperature\nG29.2 S0 ; turn off ABL\nM104 S170\n\n; build plate detect\nM1002 judge_flag build_plate_detect_flag\nM622 S1\n  G39.4\n  M400\nM623\n\nG1 Z5 F3000\nG1 X90 Y-1 F30000\nM400 P200\nM970.3 Q1 A7 K0 O2\nM974 Q1 S2 P0\n\nG1 X90 Y0 Z5 F30000\nM400 P200\nM970 Q0 A10 B50 C90 H15 K0 M20 O3\nM974 Q0 S2 P0\n\nM975 S1\nG1 F30000\nG1 X-1 Y10\nG28 X ; re-home XY\n\n;===== wipe nozzle ===============================\nM1002 gcode_claim_action : 14\nM975 S1\n\nM104 S170 ; set temp down to heatbed acceptable\nM106 S255 ; turn on fan (G28 has turn off fan)\nM211 S; push soft endstop status\nM211 X0 Y0 Z0 ;turn off Z axis endstop\n\nM83\nG1 E-1 F500\nG90\nM83\n\nM109 S170\nM104 S140\nG0 X90 Y-4 F30000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X91 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X92 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X93 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X94 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X95 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X96 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X97 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X98 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X99 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X99 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X99 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X99 F10000\nG380 S3 Z-5 F1200\nG1 Z2 F1200\nG1 X99 F10000\nG380 S3 Z-5 F1200\n\nG1 Z5 F30000\n;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;\nG1 X25 Y175 F30000.1 ;Brush material\nG1 Z0.2 F30000.1\nG1 Y185\nG91\nG1 X-30 F30000\nG1 Y-2\nG1 X27\nG1 Y1.5\nG1 X-28\nG1 Y-2\nG1 X30\nG1 Y1.5\nG1 X-30\nG90\nM83\n\nG1 Z5 F3000\nG0 X50 Y175 F20000 ; find a soft place to home\nG28 Z P0 T300; home z with low precision, permit 300deg temperature\nG29.2 S0 ; turn off ABL\n\nG0 X85 Y185 F10000 ;move to exposed steel surface and stop the nozzle\nG0 Z-1.01 F10000\nG91\n\nG2 I1 J0 X2 Y0 F2000.1\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\nG2 I1 J0 X2\nG2 I-0.75 J0 X-1.5\n\nG90\nG1 Z5 F30000\nG1 X25 Y175 F30000.1 ;Brush material\nG1 Z0.2 F30000.1\nG1 Y185\nG91\nG1 X-30 F30000\nG1 Y-2\nG1 X27\nG1 Y1.5\nG1 X-28\nG1 Y-2\nG1 X30\nG1 Y1.5\nG1 X-30\nG90\nM83\n\nG1 Z5\nG0 X55 Y175 F20000 ; find a soft place to home\nG28 Z P0 T300; home z with low precision, permit 300deg temperature\nG29.2 S0 ; turn off ABL\n\nG1 Z10\nG1 X85 Y185\nG1 Z-1.01\nG1 X95\nG1 X90\n\nM211 R; pop softend status\n\nM106 S0 ; turn off fan , too noisy\n;===== wipe nozzle end ================================\n\n\n;===== wait heatbed  ====================\nM1002 gcode_claim_action:54\nM104 S0\nM190 S[bed_temperature_initial_layer_single];set bed temp\nM109 S140\n\nG1 Z5 F3000\nG29.2 S1\nG1 X10 Y10 F20000\n\n;===== bed leveling ==================================\n;M1002 set_flag g29_before_print_flag=1\nM1002 judge_flag g29_before_print_flag\nM622 J1\n    M1002 gcode_claim_action : 1\n    G29 A1 X{first_layer_print_min[0]} Y{first_layer_print_min[1]} I{first_layer_print_size[0]} J{first_layer_print_size[1]}\n    M400\n    M500 ; save cali data\nM623\n;===== bed leveling end ================================\n\n;===== home after wipe mouth============================\nM1002 judge_flag g29_before_print_flag\nM622 J0\n\n    M1002 gcode_claim_action : 13\n    G28 T145\n\nM623\n\n;===== home after wipe mouth end =======================\n\nM975 S1 ; turn on vibration supression\n;===== nozzle load line ===============================\nM975 S1\nG90\nM83\nT1000\n\nG1 X-13.5 Y0 Z10 F10000\nG1 E1.2 F500\nM400\nM1002 set_filament_type:UNKNOWN\nM109 S{nozzle_temperature[initial_extruder]}\nM400\n\nM412 S1 ;    ===turn on  filament runout detection===\nM400 P10\n\nG392 S0 ;turn on clog detect\n\nM620.3 W1; === turn on filament tangle detection===\nM400 S2\n\nM1002 set_filament_type:{filament_type[initial_no_support_extruder]}\n;M1002 set_flag extrude_cali_flag=1\nM1002 judge_flag extrude_cali_flag\nM622 J1\n    M1002 gcode_claim_action : 8\n    \n    M400\n    M900 K0.0 L1000.0 M1.0\n    G90\n    M83\n    G0 X68 Y-4 F30000\n    G0 Z0.3 F18000 ;Move to start position\n    M400\n    G0 X88 E10  F{outer_wall_volumetric_speed/(24/20)    * 60}\n    G0 X93 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4     * 60}\n    G0 X98 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}\n    G0 X103 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4     * 60}\n    G0 X108 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}\n    G0 X113 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4     * 60}\n    G0 Y0 Z0 F20000\n    M400\n    \n    G1 X-13.5 Y0 Z10 F10000\n    M400\n    \n    G1 E10 F{outer_wall_volumetric_speed/2.4*60}\n    M983 F{outer_wall_volumetric_speed/2.4} A0.3 H[nozzle_diameter]; cali dynamic extrusion compensation\n    M106 P1 S178\n    M400 S7\n    G1 X0 F18000\n    G1 X-13.5 F3000\n    G1 X0 F18000 ;wipe and shake\n    G1 X-13.5 F3000\n    G1 X0 F12000 ;wipe and shake\n    G1 X-13.5 F3000\n    M400\n    M106 P1 S0\n\n    M1002 judge_last_extrude_cali_success\n    M622 J0\n        M983 F{outer_wall_volumetric_speed/2.4} A0.3 H[nozzle_diameter]; cali dynamic extrusion compensation\n        M106 P1 S178\n        M400 S7\n        G1 X0 F18000\n        G1 X-13.5 F3000\n        G1 X0 F18000 ;wipe and shake\n        G1 X-13.5 F3000\n        G1 X0 F12000 ;wipe and shake\n        M400\n        M106 P1 S0\n    M623\n    \n    G1 X-13.5 F3000\n    M400\n    M984 A0.1 E1 S1 F{outer_wall_volumetric_speed/2.4} H[nozzle_diameter]\n    M106 P1 S178\n    M400 S7\n    G1 X0 F18000\n    G1 X-13.5 F3000\n    G1 X0 F18000 ;wipe and shake\n    G1 X-13.5 F3000\n    G1 X0 F12000 ;wipe and shake\n    G1 X-13.5 F3000\n    M400\n    M106 P1 S0\n\nM623 ; end of \"draw extrinsic para cali paint\"\n\n;===== extrude cali test ===============================\nM104 S{nozzle_temperature_initial_layer[initial_extruder]}\nG90\nM83\nG0 X68 Y-2.5 F30000\nG0 Z0.3 F18000 ;Move to start position\nG0 X88 E10  F{outer_wall_volumetric_speed/(24/20)    * 60}\nG0 X93 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4     * 60}\nG0 X98 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}\nG0 X103 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4     * 60}\nG0 X108 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}\nG0 X113 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4     * 60}\nG0 X115 Z0 F20000\nG0 Z5\nM400\n\n;========turn off light and wait extrude temperature =============\nM1002 gcode_claim_action : 0\n\nM400 ; wait all motion done before implement the emprical L parameters\n\n;===== for Textured PEI Plate , lower the nozzle as the nozzle was touching topmost of the texture when homing ==\n;curr_bed_type={curr_bed_type}\n{if curr_bed_type==\"Textured PEI Plate\"}\nG29.1 Z{-0.02} ; for Textured PEI Plate\n{endif}\n\nM960 S1 P0 ; turn off laser\nM960 S2 P0 ; turn off laser\nM106 S0 ; turn off fan\nM106 P2 S0 ; turn off big fan\nM106 P3 S0 ; turn off chamber fan\n\nM975 S1 ; turn on mech mode supression\nG90\nM83\nT1000\n\nM211 X0 Y0 Z0 ;turn off soft endstop\nM1007 S1\n\n\n\n
; machine_switch_extruder_time = 0
; machine_unload_filament_time = 34
; master_extruder_id = 1
; max_bridge_length = 0
; max_layer_height = 0.28
; max_travel_detour_distance = 0
; min_bead_width = 85%
; min_feature_size = 25%
; min_layer_height = 0.08
; minimum_sparse_infill_area = 15
; mmu_segmented_region_interlocking_depth = 0
; mmu_segmented_region_max_width = 0
; monotonic_travel_into_wall = 0%
; no_slow_down_for_cooling_on_outwalls = 0,0,0,0
; nozzle_diameter = 0.4
; nozzle_flush_dataset = 0
; nozzle_height = 4.76
; nozzle_temperature = 220,245,220,220
; nozzle_temperature_initial_layer = 220,245,220,220
; nozzle_temperature_range_high = 240,270,240,240
; nozzle_temperature_range_low = 190,230,190,190
; nozzle_type = stainless_steel
; nozzle_volume = 92
; nozzle_volume_type = Standard
; only_one_wall_first_layer = 0
; ooze_prevention = 0
; other_layers_print_sequence = 0
; other_layers_print_sequence_nums = 0
; outer_wall_acceleration = 5000
; outer_wall_jerk = 9
; outer_wall_line_width = 0.42
; outer_wall_speed = 200
; overhang_1_4_speed = 0
; overhang_2_4_speed = 50
; overhang_3_4_speed = 30
; overhang_4_4_speed = 10
; overhang_fan_speed = 100,50,100,100
; overhang_fan_threshold = 50%,10%,50%,50%
; overhang_threshold_participating_cooling = 95%,95%,95%,95%
; overhang_totally_speed = 10
; override_filament_scarf_seam_setting = 0
; override_process_overhang_speed = 0,0,0,0
; physical_extruder_map = 0
; post_process = 
; pre_start_fan_time = 2,2,2,2
; precise_outer_wall = 0
; precise_z_height = 0
; pressure_advance = 0.02,0.02,0.02,0.02
; prime_tower_brim_width = 3
; prime_tower_enable_framework = 0
; prime_tower_extra_rib_length = 0
; prime_tower_fillet_wall = 1
; prime_tower_flat_ironing = 0
; prime_tower_infill_gap = 150%
; prime_tower_lift_height = -1
; prime_tower_lift_speed = 90
; prime_tower_max_speed = 90
; prime_tower_rib_wall = 1
; prime_tower_rib_width = 8
; prime_tower_skip_points = 1
; prime_tower_width = 35
; prime_volume_mode = Default
; print_compatible_printers = "Bambu Lab A1 mini 0.4 nozzle"
; print_extruder_id = 1
; print_extruder_variant = "Direct Drive Standard"
; print_flow_ratio = 1
; print_in_clockwise = 0
; print_sequence = by layer
; print_settings_id = 0.20mm Standard @BBL A1M
; printable_area = 0x0,180x0,180x180,0x180
; printable_height = 180
; printer_extruder_id = 1
; printer_extruder_variant = "Direct Drive Standard"
; printer_model = Bambu Lab A1 mini
; printer_notes = 
; printer_settings_id = Bambu Lab A1 mini 0.4 nozzle
; printer_structure = i3
; printer_technology = FFF
; printer_variant = 0.4
; printhost_authorization_type = key
; printhost_ssl_ignore_revoke = 0
; printing_by_object_gcode = 
; process_notes = 
; raft_contact_distance = 0.1
; raft_expansion = 1.5
; raft_first_layer_density = 90%
; raft_first_layer_expansion = -1
; raft_layers = 0
; reduce_crossing_wall = 0
; reduce_fan_stop_start_freq = 1,1,1,1
; reduce_infill_retraction_mode = Auto
; required_nozzle_HRC = 3,3,3,3
; resolution = 0.012
; retract_before_wipe = 0%
; retract_length_toolchange = 2
; retract_lift_above = 0
; retract_lift_below = 179
; retract_restart_extra = 0
; retract_restart_extra_toolchange = 0
; retract_when_changing_layer = 1
; retraction_distances_when_cut = 18
; retraction_distances_when_ec = 0,0,0,0
; retraction_length = 0.8
; retraction_minimum_travel = 1
; retraction_speed = 30
; role_base_wipe_speed = 1
; scan_first_layer = 0
; scarf_angle_threshold = 155
; seam_gap = 15%
; seam_placement_away_from_overhangs = 0
; seam_position = aligned
; seam_slope_conditional = 1
; seam_slope_entire_loop = 0
; seam_slope_gap = 0
; seam_slope_inner_walls = 1
; seam_slope_min_length = 10
; seam_slope_start_height = 10%
; seam_slope_steps = 10
; seam_slope_type = none
; silent_mode = 0
; single_extruder_multi_material = 1
; skeleton_infill_density = 15%
; skeleton_infill_line_width = 0.45
; skin_infill_density = 15%
; skin_infill_depth = 2
; skin_infill_line_width = 0.45
; skirt_distance = 2
; skirt_height = 1
; skirt_loops = 0
; skirt_per_object = 1
; slice_closing_radius = 0.049
; slicing_mode = regular
; slow_down_for_layer_cooling = 1,1,1,1
; slow_down_layer_time = 6,12,6,6
; slow_down_min_speed = 20,10,20,20
; slowdown_end_acc = 100000
; slowdown_end_height = 400
; slowdown_end_speed = 1000
; slowdown_start_acc = 100000
; slowdown_start_height = 0
; slowdown_start_speed = 1000
; small_perimeter_speed = 50%
; small_perimeter_threshold = 0
; smooth_coefficient = 80
; smooth_speed_discontinuity_area = 1
; solid_infill_filament = 0
; sparse_infill_acceleration = 100%
; sparse_infill_anchor = 400%
; sparse_infill_anchor_max = 20
; sparse_infill_density = 15%
; sparse_infill_filament = 0
; sparse_infill_lattice_angle_1 = -45
; sparse_infill_lattice_angle_2 = 45
; sparse_infill_line_width = 0.45
; sparse_infill_pattern = grid
; sparse_infill_speed = 270
; spiral_mode = 0
; spiral_mode_max_xy_smoothing = 200%
; spiral_mode_smooth = 0
; standby_temperature_delta = -5
; start_end_points = 30x-3,54x245
; supertack_plate_temp = 45,70,45,45
; supertack_plate_temp_initial_layer = 45,70,45,45
; support_air_filtration = 0
; support_angle = 0
; support_base_pattern = default
; support_base_pattern_spacing = 2.5
; support_bottom_interface_spacing = 0.5
; support_bottom_z_distance = 0.2
; support_chamber_temp_control = 0
; support_cooling_filter = 0
; support_critical_regions_only = 0
; support_expansion = 0
; support_fast_purge_mode = 0
; support_filament = 0
; support_interface_bottom_layers = 2
; support_interface_filament = 0
; support_interface_loop_pattern = 0
; support_interface_not_for_body = 1
; support_interface_pattern = auto
; support_interface_spacing = 0.5
; support_interface_speed = 80
; support_interface_top_layers = 2
; support_ironing_direction = 0
; support_ironing_flow = 10%
; support_ironing_inset = 0
; support_ironing_pattern = zig-zag
; support_ironing_spacing = 0.15
; support_ironing_speed = 30
; support_line_width = 0.42
; support_object_first_layer_gap = 0.2
; support_object_skip_flush = 0
; support_object_xy_distance = 0.35
; support_on_build_plate_only = 0
; support_remove_small_overhang = 1
; support_speed = 150
; support_style = default
; support_threshold_angle = 30
; support_top_z_distance = 0.2
; support_type = tree(auto)
; symmetric_infill_y_axis = 0
; temperature_vitrification = 45,60,45,45
; template_custom_gcode = 
; textured_plate_temp = 65,70,65,65
; textured_plate_temp_initial_layer = 65,70,65,65
; thick_bridges = 0
; thumbnail_size = 50x50
; time_lapse_gcode = ;===================== date: 20250206 =====================\n{if !spiral_mode && print_sequence != \"by object\"}\n; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer\n; SKIPPABLE_START\n; SKIPTYPE: timelapse\nM622.1 S1 ; for prev firmware, default turned on\nM1002 judge_flag timelapse_record_flag\nM622 J1\nG92 E0\nG1 Z{max_layer_z + 0.4}\nG1 X0 Y{first_layer_center_no_wipe_tower[1]} F18000 ; move to safe pos\nG1 X-13.0 F3000 ; move to safe pos\nM400\nM1004 S5 P1  ; external shutter\nM400 P300\nM971 S11 C11 O0\nG92 E0\nG1 X0 F18000\nM623\n\n; SKIPTYPE: head_wrap_detect\nM622.1 S1\nM1002 judge_flag g39_3rd_layer_detect_flag\nM622 J1\n    ; enable nozzle clog detect at 3rd layer\n    {if layer_num == 2}\n      M400\n      G90\n      M83\n      M204 S5000\n      G0 Z2 F4000\n      G0 X187 Y178 F20000\n      G39 S1 X187 Y178\n      G0 Z2 F4000\n    {endif}\n\n\n    M622.1 S1\n    M1002 judge_flag g39_detection_flag\n    M622 J1\n      {if !in_head_wrap_detect_zone}\n        M622.1 S0\n        M1002 judge_flag g39_mass_exceed_flag\n        M622 J1\n        {if layer_num > 2}\n            G392 S0\n            M400\n            G90\n            M83\n            M204 S5000\n            G0 Z{max_layer_z + 0.4} F4000\n            G39.3 S1\n            G0 Z{max_layer_z + 0.4} F4000\n            G392 S0\n          {endif}\n        M623\n    {endif}\n    M623\nM623\n; SKIPPABLE_END\n{endif}\n\n\n
; timelapse_type = 0
; top_area_threshold = 200%
; top_color_penetration_layers = 5
; top_one_wall_type = all top
; top_shell_layers = 5
; top_shell_thickness = 1
; top_solid_infill_flow_ratio = 1
; top_surface_acceleration = 2000
; top_surface_density = 100%
; top_surface_jerk = 9
; top_surface_line_width = 0.42
; top_surface_pattern = monotonicline
; top_surface_speed = 200
; top_z_overrides_xy_distance = 0
; travel_acceleration = 10000
; travel_jerk = 9
; travel_short_distance_acceleration = 250
; travel_speed = 700
; travel_speed_z = 0
; tree_support_branch_angle = 45
; tree_support_branch_diameter = 2
; tree_support_branch_diameter_angle = 5
; tree_support_branch_distance = 5
; tree_support_wall_count = -1
; upward_compatible_machine = "Bambu Lab P1S 0.4 nozzle";"Bambu Lab P1P 0.4 nozzle";"Bambu Lab X1 0.4 nozzle";"Bambu Lab X1 Carbon 0.4 nozzle";"Bambu Lab X1E 0.4 nozzle";"Bambu Lab A1 0.4 nozzle";"Bambu Lab H2D 0.4 nozzle";"Bambu Lab H2D Pro 0.4 nozzle";"Bambu Lab H2S 0.4 nozzle";"Bambu Lab P2S 0.4 nozzle";"Bambu Lab H2C 0.4 nozzle";"Bambu Lab X2D 0.4 nozzle";"Bambu Lab A2L 0.4 nozzle"
; use_firmware_retraction = 0
; use_relative_e_distances = 1
; vertical_shell_speed = 80%
; volumetric_speed_coefficients = "0 0 0 0 0 0";"0 0 0 0 0 0";"0 0 0 0 0 0";"0 0 0 0 0 0"
; wall_distribution_count = 1
; wall_filament = 0
; wall_generator = classic
; wall_loops = 2
; wall_sequence = inner wall/outer wall
; wall_transition_angle = 10
; wall_transition_filter_deviation = 25%
; wall_transition_length = 100%
; wipe = 1
; wipe_distance = 2
; wipe_speed = 80%
; wipe_tower_no_sparse_layers = 0
; wipe_tower_rotation_angle = 0
; wipe_tower_x = 15
; wipe_tower_y = 142.573
; wrapping_detection_gcode = 
; wrapping_detection_layers = 20
; wrapping_exclude_area = 
; xy_contour_compensation = 0
; xy_hole_compensation = 0
; z_direction_outwall_speed_continuous = 0
; z_hop = 0.4
; z_hop_types = Auto Lift
; CONFIG_BLOCK_END

; EXECUTABLE_BLOCK_START
M73 P0 R11
M201 X20000 Y20000 Z1500 E5000
M203 X500 Y500 Z30 E30
M204 P20000 R5000 T20000
M205 X9.00 Y9.00 Z5.00 E3.00
M106 S0
; FEATURE: Custom
;===== machine: A1 mini =========================
;===== date: 20260513 ==================

;===== start to heat heatbead&hotend==========
M1002 gcode_claim_action : 2
M1002 set_filament_type:PLA
M104 S170
M140 S65
G392 S0 ;turn off clog detect
M9833.2
;=====start printer sound ===================
M17
M400 S1
M1006 S1
M1006 A0 B0 L100 C37 D10 M100 E37 F10 N100
M1006 A0 B0 L100 C41 D10 M100 E41 F10 N100
M1006 A0 B0 L100 C44 D10 M100 E44 F10 N100
M1006 A0 B10 L100 C0 D10 M100 E0 F10 N100
M1006 A43 B10 L100 C39 D10 M100 E46 F10 N100
M1006 A0 B0 L100 C0 D10 M100 E0 F10 N100
M1006 A0 B0 L100 C39 D10 M100 E43 F10 N100
M1006 A0 B0 L100 C0 D10 M100 E0 F10 N100
M1006 A0 B0 L100 C41 D10 M100 E41 F10 N100
M1006 A0 B0 L100 C44 D10 M100 E44 F10 N100
M1006 A0 B0 L100 C49 D10 M100 E49 F10 N100
M1006 A0 B0 L100 C0 D10 M100 E0 F10 N100
M1006 A44 B10 L100 C39 D10 M100 E48 F10 N100
M1006 A0 B0 L100 C0 D10 M100 E0 F10 N100
M1006 A0 B0 L100 C39 D10 M100 E44 F10 N100
M1006 A0 B0 L100 C0 D10 M100 E0 F10 N100
M1006 A43 B10 L100 C39 D10 M100 E46 F10 N100
M1006 W
M18
;=====avoid end stop =================
G91
G380 S2 Z30 F1200
G380 S3 Z-20 F1200
G1 Z5 F1200
G90

;===== reset machine status =================
M204 S6000

M630 S0 P0
G91
M17 Z0.3 ; lower the z-motor current

G90
M17 X0.7 Y0.9 Z0.5 ; reset motor current to default
M960 S5 P1 ; turn on logo lamp
G90
M83
M220 S100 ;Reset Feedrate
M221 S100 ;Reset Flowrate
M73.2   R1.0 ;Reset left time magnitude
;====== cog noise reduction=================
M982.2 S1 ; turn on cog noise reduction

;===== prepare print temperature and material ==========
M400
M18
M109 S100 H170
M104 S170
M400
M17
M400
G28 X

M211 X0 Y0 Z0 ;turn off soft endstop ; turn off soft endstop to prevent protential logic problem

M975 S1 ; turn on

G1 X0.0 F30000
G1 X-13.5 F3000

M620 M ;enable remap
M620 S0A   ; switch material if AMS exist
    G392 S0 ;turn on clog detect
    M1002 gcode_claim_action : 4
    M400
    M1002 set_filament_type:UNKNOWN
    M109 S220

    M104 S220

    M400
    T0
    G1 X-13.5 F3000
    M400

    M620.1 E F523.843 T220
    M109 S220 ;set nozzle to common flush temp

    M106 P1 S0
    G92 E0
M73 P4 R10
    G1 E50 F200
    M400
    M1002 set_filament_type:PLA

    M104 S220

    G92 E0
    G1 E50 F523.843
    M400
    M106 P1 S178
    G92 E0
M73 P6 R10
    G1 E5 F523.843
    M109 S200 ; drop nozzle temp, make filament shink a bit
    M104 S180
    G92 E0
M73 P7 R10
    G1 E-0.5 F300

    G1 X0 F30000
    G1 X-13.5 F3000
    G1 X0 F30000 ;wipe and shake
    G1 X-13.5 F3000
    G1 X0 F12000 ;wipe and shake
    G1 X0 F30000
    G1 X-13.5 F3000
    M109 S180
    G392 S0 ;turn off clog detect
M621 S0A

M400
M106 P1 S0
;===== prepare print temperature and material end =====


;===== mech mode fast check============================
M1002 gcode_claim_action : 3
G0 X25 Y175 F20000 ; find a soft place to home
;M104 S0
G28 Z P0 T300; home z with low precision,permit 300deg temperature
G29.2 S0 ; turn off ABL
M104 S170

; build plate detect
M1002 judge_flag build_plate_detect_flag
M622 S1
  G39.4
  M400
M623

G1 Z5 F3000
G1 X90 Y-1 F30000
M400 P200
M970.3 Q1 A7 K0 O2
M974 Q1 S2 P0

G1 X90 Y0 Z5 F30000
M400 P200
M970 Q0 A10 B50 C90 H15 K0 M20 O3
M974 Q0 S2 P0

M975 S1
G1 F30000
G1 X-1 Y10
G28 X ; re-home XY

;===== wipe nozzle ===============================
M1002 gcode_claim_action : 14
M975 S1

M104 S170 ; set temp down to heatbed acceptable
M106 S255 ; turn on fan (G28 has turn off fan)
M211 S; push soft endstop status
M211 X0 Y0 Z0 ;turn off Z axis endstop

M83
G1 E-1 F500
G90
M83

M109 S170
M104 S140
G0 X90 Y-4 F30000
G380 S3 Z-5 F1200
M73 P46 R5
G1 Z2 F1200
G1 X91 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X92 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X93 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X94 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X95 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X96 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X97 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X98 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200

G1 Z5 F30000
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
G1 X25 Y175 F30000.1 ;Brush material
G1 Z0.2 F30000.1
G1 Y185
G91
G1 X-30 F30000
G1 Y-2
G1 X27
G1 Y1.5
G1 X-28
G1 Y-2
G1 X30
G1 Y1.5
M73 P47 R5
G1 X-30
G90
M83

G1 Z5 F3000
G0 X50 Y175 F20000 ; find a soft place to home
G28 Z P0 T300; home z with low precision, permit 300deg temperature
G29.2 S0 ; turn off ABL

G0 X85 Y185 F10000 ;move to exposed steel surface and stop the nozzle
G0 Z-1.01 F10000
G91

G2 I1 J0 X2 Y0 F2000.1
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5

G90
G1 Z5 F30000
G1 X25 Y175 F30000.1 ;Brush material
G1 Z0.2 F30000.1
G1 Y185
G91
G1 X-30 F30000
G1 Y-2
G1 X27
G1 Y1.5
G1 X-28
G1 Y-2
G1 X30
G1 Y1.5
G1 X-30
G90
M83

G1 Z5
G0 X55 Y175 F20000 ; find a soft place to home
G28 Z P0 T300; home z with low precision, permit 300deg temperature
G29.2 S0 ; turn off ABL

G1 Z10
G1 X85 Y185
G1 Z-1.01
G1 X95
G1 X90

M211 R; pop softend status

M106 S0 ; turn off fan , too noisy
;===== wipe nozzle end ================================


;===== wait heatbed  ====================
M1002 gcode_claim_action:54
M104 S0
M190 S65;set bed temp
M109 S140

G1 Z5 F3000
G29.2 S1
G1 X10 Y10 F20000

;===== bed leveling ==================================
;M1002 set_flag g29_before_print_flag=1
M1002 judge_flag g29_before_print_flag
M622 J1
    M1002 gcode_claim_action : 1
    G29 A1 X67.5 Y83.4814 I45 J13.0372
    M400
    M500 ; save cali data
M623
;===== bed leveling end ================================

;===== home after wipe mouth============================
M1002 judge_flag g29_before_print_flag
M622 J0

    M1002 gcode_claim_action : 13
    G28 T145

M623

;===== home after wipe mouth end =======================

M975 S1 ; turn on vibration supression
;===== nozzle load line ===============================
M975 S1
G90
M83
T1000

G1 X-13.5 Y0 Z10 F10000
G1 E1.2 F500
M400
M1002 set_filament_type:UNKNOWN
M109 S220
M400

M412 S1 ;    ===turn on  filament runout detection===
M400 P10

G392 S0 ;turn on clog detect

M620.3 W1; === turn on filament tangle detection===
M400 S2

M1002 set_filament_type:PLA
;M1002 set_flag extrude_cali_flag=1
M1002 judge_flag extrude_cali_flag
M622 J1
    M1002 gcode_claim_action : 8
    
    M400
    M900 K0.0 L1000.0 M1.0
    G90
    M83
    G0 X68 Y-4 F30000
    G0 Z0.3 F18000 ;Move to start position
    M400
    G0 X88 E10  F904.991
    G0 X93 E.3742  F1508.32
    G0 X98 E.3742  F6033.27
    G0 X103 E.3742  F1508.32
    G0 X108 E.3742  F6033.27
    G0 X113 E.3742  F1508.32
    G0 Y0 Z0 F20000
    M400
    
    G1 X-13.5 Y0 Z10 F10000
    M400
    
    G1 E10 F377.08
    M983 F6.28466 A0.3 H0.4; cali dynamic extrusion compensation
    M106 P1 S178
    M400 S7
    G1 X0 F18000
    G1 X-13.5 F3000
    G1 X0 F18000 ;wipe and shake
    G1 X-13.5 F3000
    G1 X0 F12000 ;wipe and shake
    G1 X-13.5 F3000
    M400
    M106 P1 S0

    M1002 judge_last_extrude_cali_success
    M622 J0
        M983 F6.28466 A0.3 H0.4; cali dynamic extrusion compensation
        M106 P1 S178
        M400 S7
        G1 X0 F18000
M73 P48 R5
        G1 X-13.5 F3000
        G1 X0 F18000 ;wipe and shake
        G1 X-13.5 F3000
        G1 X0 F12000 ;wipe and shake
        M400
        M106 P1 S0
    M623
    
M73 P49 R5
    G1 X-13.5 F3000
    M400
    M984 A0.1 E1 S1 F6.28466 H0.4
    M106 P1 S178
    M400 S7
    G1 X0 F18000
    G1 X-13.5 F3000
    G1 X0 F18000 ;wipe and shake
    G1 X-13.5 F3000
    G1 X0 F12000 ;wipe and shake
    G1 X-13.5 F3000
    M400
    M106 P1 S0

M623 ; end of "draw extrinsic para cali paint"

;===== extrude cali test ===============================
M104 S220
G90
M83
G0 X68 Y-2.5 F30000
G0 Z0.3 F18000 ;Move to start position
G0 X88 E10  F904.991
G0 X93 E.3742  F1508.32
G0 X98 E.3742  F6033.27
G0 X103 E.3742  F1508.32
G0 X108 E.3742  F6033.27
G0 X113 E.3742  F1508.32
G0 X115 Z0 F20000
G0 Z5
M400

;========turn off light and wait extrude temperature =============
M1002 gcode_claim_action : 0

M400 ; wait all motion done before implement the emprical L parameters

;===== for Textured PEI Plate , lower the nozzle as the nozzle was touching topmost of the texture when homing ==
;curr_bed_type=Textured PEI Plate

G29.1 Z-0.02 ; for Textured PEI Plate


M960 S1 P0 ; turn off laser
M960 S2 P0 ; turn off laser
M106 S0 ; turn off fan
M106 P2 S0 ; turn off big fan
M106 P3 S0 ; turn off chamber fan

M975 S1 ; turn on mech mode supression
G90
M83
T1000

M211 X0 Y0 Z0 ;turn off soft endstop
M1007 S1



; MACHINE_START_GCODE_END
; filament start gcode
M106 P3 S200


;VT0 H-1
G90
G21
M83 ; use relative distances for extrusion
M981 S1 P20000 ;open spaghetti detector
; CHANGE_LAYER
; Z_HEIGHT: 0.2
; LAYER_HEIGHT: 0.2
G1 E-.8 F1800
; layer num/total_layer_count: 1/15
; update layer progress
M73 L1
M991 S0 P0 ;notify layer change
M106 S0
; OBJECT_ID: 110
G1 X111.793 Y95.812 F42000
M204 S6000
M73 P50 R5
G1 Z.4
G1 Z.2
M73 P51 R5
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.5
G1 F3000
M204 S500
G1 X68.207 Y95.812 E1.62341
G1 X68.207 Y84.188 E.43291
G1 X111.793 Y84.188 E1.62341
G1 X111.793 Y95.752 E.43068
M204 S6000
M73 P52 R5
G1 X112.25 Y96.269 F42000
; FEATURE: Outer wall
G1 F3000
M204 S500
G1 X67.75 Y96.269 E1.65746
G1 X67.75 Y83.731 E.46696
G1 X112.25 Y83.731 E1.65746
G1 X112.25 Y96.209 E.46473
; WIPE_START
G1 X110.25 Y96.211 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S6000
G17
G3 Z.6 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z0.6
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X110.681 Y84.371 F42000
M73 P53 R5
G1 Z.2
G1 E.8 F1800
; FEATURE: Bottom surface
; LINE_WIDTH: 0.50227
G1 F6300
M204 S500
G1 X111.404 Y85.094 E.03828
G1 X111.404 Y85.744 E.02432
G1 X110.237 Y84.577 E.06178
G1 X109.588 Y84.577 E.02432
G1 X111.404 Y86.394 E.09617
G1 X111.404 Y87.043 E.02432
G1 X108.938 Y84.577 E.13055
G1 X108.289 Y84.577 E.02432
G1 X111.404 Y87.693 E.16494
G1 X111.404 Y88.343 E.02432
G1 X107.639 Y84.577 E.19933
G1 X106.989 Y84.577 E.02432
G1 X111.404 Y88.992 E.23372
G1 X111.404 Y89.642 E.02432
G1 X106.34 Y84.577 E.26811
G1 X105.69 Y84.577 E.02432
G1 X111.404 Y90.291 E.30249
G1 X111.404 Y90.941 E.02432
G1 X105.04 Y84.577 E.33688
M73 P54 R5
G1 X104.391 Y84.577 E.02432
G1 X111.404 Y91.591 E.37127
G1 X111.404 Y92.24 E.02432
G1 X103.741 Y84.577 E.40566
G1 X103.092 Y84.577 E.02432
G1 X111.404 Y92.89 E.44005
G1 X111.404 Y93.539 E.02432
G1 X102.442 Y84.577 E.47443
G1 X101.792 Y84.577 E.02432
G1 X111.404 Y94.189 E.50882
G1 X111.404 Y94.839 E.02432
G1 X101.143 Y84.577 E.54321
G1 X100.493 Y84.577 E.02432
G1 X111.339 Y95.423 E.57414
G1 X110.69 Y95.423 E.02432
G1 X99.843 Y84.577 E.57414
G1 X99.194 Y84.577 E.02432
G1 X110.04 Y95.423 E.57414
G1 X109.39 Y95.423 E.02432
G1 X98.544 Y84.577 E.57414
G1 X97.895 Y84.577 E.02432
G1 X108.741 Y95.423 E.57414
G1 X108.091 Y95.423 E.02432
G1 X97.245 Y84.577 E.57414
G1 X96.595 Y84.577 E.02432
G1 X107.441 Y95.423 E.57414
G1 X106.792 Y95.423 E.02432
G1 X95.946 Y84.577 E.57414
G1 X95.296 Y84.577 E.02432
G1 X106.142 Y95.423 E.57414
G1 X105.493 Y95.423 E.02432
G1 X94.647 Y84.577 E.57414
G1 X93.997 Y84.577 E.02432
G1 X104.843 Y95.423 E.57414
G1 X104.193 Y95.423 E.02432
G1 X93.347 Y84.577 E.57414
G1 X92.698 Y84.577 E.02432
G1 X103.544 Y95.423 E.57414
G1 X102.894 Y95.423 E.02432
G1 X92.048 Y84.577 E.57414
G1 X91.398 Y84.577 E.02432
G1 X102.244 Y95.423 E.57414
G1 X101.595 Y95.423 E.02432
G1 X90.749 Y84.577 E.57414
G1 X90.099 Y84.577 E.02432
G1 X100.945 Y95.423 E.57414
G1 X100.296 Y95.423 E.02432
M73 P55 R5
G1 X89.45 Y84.577 E.57414
G1 X88.8 Y84.577 E.02432
G1 X99.646 Y95.423 E.57414
G1 X98.996 Y95.423 E.02432
G1 X88.15 Y84.577 E.57414
G1 X87.501 Y84.577 E.02432
G1 X98.347 Y95.423 E.57414
G1 X97.697 Y95.423 E.02432
G1 X86.851 Y84.577 E.57414
G1 X86.201 Y84.577 E.02432
G1 X97.048 Y95.423 E.57414
G1 X96.398 Y95.423 E.02432
G1 X85.552 Y84.577 E.57414
G1 X84.902 Y84.577 E.02432
G1 X95.748 Y95.423 E.57414
M73 P55 R4
G1 X95.099 Y95.423 E.02432
G1 X84.253 Y84.577 E.57414
G1 X83.603 Y84.577 E.02432
G1 X94.449 Y95.423 E.57414
G1 X93.799 Y95.423 E.02432
G1 X82.953 Y84.577 E.57414
G1 X82.304 Y84.577 E.02432
G1 X93.15 Y95.423 E.57414
G1 X92.5 Y95.423 E.02432
G1 X81.654 Y84.577 E.57414
G1 X81.005 Y84.577 E.02432
G1 X91.851 Y95.423 E.57414
G1 X91.201 Y95.423 E.02432
G1 X80.355 Y84.577 E.57414
G1 X79.705 Y84.577 E.02432
G1 X90.551 Y95.423 E.57414
G1 X89.902 Y95.423 E.02432
G1 X79.056 Y84.577 E.57414
G1 X78.406 Y84.577 E.02432
G1 X89.252 Y95.423 E.57414
G1 X88.602 Y95.423 E.02432
M73 P56 R4
G1 X77.756 Y84.577 E.57414
G1 X77.107 Y84.577 E.02432
G1 X87.953 Y95.423 E.57414
G1 X87.303 Y95.423 E.02432
G1 X76.457 Y84.577 E.57414
G1 X75.808 Y84.577 E.02432
G1 X86.654 Y95.423 E.57414
G1 X86.004 Y95.423 E.02432
G1 X75.158 Y84.577 E.57414
G1 X74.508 Y84.577 E.02432
G1 X85.354 Y95.423 E.57414
G1 X84.705 Y95.423 E.02432
G1 X73.859 Y84.577 E.57414
G1 X73.209 Y84.577 E.02432
G1 X84.055 Y95.423 E.57414
G1 X83.406 Y95.423 E.02432
G1 X72.559 Y84.577 E.57414
G1 X71.91 Y84.577 E.02432
G1 X82.756 Y95.423 E.57414
G1 X82.106 Y95.423 E.02432
G1 X71.26 Y84.577 E.57414
G1 X70.611 Y84.577 E.02432
G1 X81.457 Y95.423 E.57414
G1 X80.807 Y95.423 E.02432
G1 X69.961 Y84.577 E.57414
G1 X69.311 Y84.577 E.02432
G1 X80.157 Y95.423 E.57414
G1 X79.508 Y95.423 E.02432
G1 X68.662 Y84.577 E.57414
G1 X68.596 Y84.577 E.00248
G1 X68.596 Y85.16 E.02184
G1 X78.858 Y95.423 E.54326
G1 X78.209 Y95.423 E.02432
G1 X68.596 Y85.81 E.50887
G1 X68.596 Y86.46 E.02432
G1 X77.559 Y95.423 E.47448
G1 X76.909 Y95.423 E.02432
G1 X68.596 Y87.109 E.44009
M73 P57 R4
G1 X68.596 Y87.759 E.02432
G1 X76.26 Y95.423 E.40571
G1 X75.61 Y95.423 E.02432
G1 X68.596 Y88.409 E.37132
G1 X68.596 Y89.058 E.02432
G1 X74.96 Y95.423 E.33693
G1 X74.311 Y95.423 E.02432
G1 X68.596 Y89.708 E.30254
G1 X68.596 Y90.357 E.02432
G1 X73.661 Y95.423 E.26815
G1 X73.012 Y95.423 E.02432
G1 X68.596 Y91.007 E.23377
G1 X68.596 Y91.657 E.02432
G1 X72.362 Y95.423 E.19938
G1 X71.712 Y95.423 E.02432
G1 X68.596 Y92.306 E.16499
G1 X68.596 Y92.956 E.02432
G1 X71.063 Y95.423 E.1306
G1 X70.413 Y95.423 E.02432
G1 X68.596 Y93.605 E.09621
G1 X68.596 Y94.255 E.02432
G1 X69.764 Y95.423 E.06182
G1 X69.114 Y95.423 E.02432
G1 X68.39 Y94.699 E.03832
; CHANGE_LAYER
; Z_HEIGHT: 0.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F6300
G1 X69.114 Y95.423 E-.38907
G1 X69.764 Y95.423 E-.24686
G1 X69.533 Y95.192 E-.12407
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 2/15
; update layer progress
M73 L2
M991 S0 P1 ;notify layer change
M106 S201.45
; open powerlost recovery
M1003 S1
; OBJECT_ID: 110
M204 S10000
G17
G3 Z.6 I-.021 J1.217 P1  F42000
G1 X111.898 Y95.917 Z.6
G1 Z.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
M73 P58 R4
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z.8 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z0.8
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X110.97 Y95.753 F42000
G1 Z.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42084
G1 F15000
M204 S6000
G1 X111.565 Y95.159 E.02589
G1 X111.565 Y94.624 E.01646
G1 X110.606 Y95.583 E.04177
G1 X110.071 Y95.583 E.01646
G1 X111.565 Y94.09 E.06505
G1 X111.565 Y93.555 E.01646
G1 X109.537 Y95.583 E.08833
G1 X109.002 Y95.583 E.01646
G1 X111.565 Y93.021 E.1116
G1 X111.565 Y92.486 E.01646
G1 X108.468 Y95.583 E.13488
G1 X107.933 Y95.583 E.01646
G1 X111.565 Y91.952 E.15816
G1 X111.565 Y91.417 E.01646
G1 X107.399 Y95.583 E.18143
G1 X106.864 Y95.583 E.01646
G1 X111.565 Y90.883 E.20471
G1 X111.565 Y90.348 E.01646
G1 X106.33 Y95.583 E.22799
G1 X105.795 Y95.583 E.01646
G1 X111.565 Y89.814 E.25126
G1 X111.565 Y89.28 E.01646
G1 X105.261 Y95.583 E.27454
G1 X104.726 Y95.583 E.01646
G1 X111.565 Y88.745 E.29782
G1 X111.565 Y88.211 E.01646
G1 X104.192 Y95.583 E.32109
G1 X103.658 Y95.583 E.01646
G1 X111.565 Y87.676 E.34437
G1 X111.565 Y87.142 E.01646
G1 X103.123 Y95.583 E.36765
G1 X102.589 Y95.583 E.01646
G1 X111.565 Y86.607 E.39092
G1 X111.565 Y86.073 E.01646
G1 X102.054 Y95.583 E.4142
G1 X101.52 Y95.583 E.01646
G1 X111.565 Y85.538 E.43748
G1 X111.565 Y85.004 E.01646
G1 X100.985 Y95.583 E.46075
G1 X100.451 Y95.583 E.01646
G1 X111.565 Y84.469 E.48403
G1 X111.565 Y84.417 E.00162
G1 X111.083 Y84.417 E.01484
G1 X99.916 Y95.583 E.48632
G1 X99.382 Y95.583 E.01646
G1 X110.548 Y84.417 E.48632
G1 X110.014 Y84.417 E.01646
G1 X98.847 Y95.583 E.48632
G1 X98.313 Y95.583 E.01646
G1 X109.479 Y84.417 E.48632
G1 X108.945 Y84.417 E.01646
G1 X97.778 Y95.583 E.48632
G1 X97.244 Y95.583 E.01646
G1 X108.411 Y84.417 E.48632
G1 X107.876 Y84.417 E.01646
G1 X96.71 Y95.583 E.48632
G1 X96.175 Y95.583 E.01646
G1 X107.342 Y84.417 E.48632
G1 X106.807 Y84.417 E.01646
G1 X95.641 Y95.583 E.48632
G1 X95.106 Y95.583 E.01646
G1 X106.273 Y84.417 E.48632
G1 X105.738 Y84.417 E.01646
G1 X94.572 Y95.583 E.48632
G1 X94.037 Y95.583 E.01646
G1 X105.204 Y84.417 E.48632
G1 X104.669 Y84.417 E.01646
G1 X93.503 Y95.583 E.48632
G1 X92.968 Y95.583 E.01646
G1 X104.135 Y84.417 E.48632
G1 X103.6 Y84.417 E.01646
G1 X92.434 Y95.583 E.48632
G1 X91.899 Y95.583 E.01646
G1 X103.066 Y84.417 E.48632
G1 X102.532 Y84.417 E.01646
G1 X91.365 Y95.583 E.48632
G1 X90.831 Y95.583 E.01646
G1 X101.997 Y84.417 E.48632
G1 X101.463 Y84.417 E.01646
M73 P59 R4
G1 X90.296 Y95.583 E.48632
G1 X89.762 Y95.583 E.01646
G1 X100.928 Y84.417 E.48632
G1 X100.394 Y84.417 E.01646
G1 X89.227 Y95.583 E.48632
G1 X88.693 Y95.583 E.01646
G1 X99.859 Y84.417 E.48632
G1 X99.325 Y84.417 E.01646
G1 X88.158 Y95.583 E.48632
G1 X87.624 Y95.583 E.01646
G1 X98.79 Y84.417 E.48632
G1 X98.256 Y84.417 E.01646
G1 X87.089 Y95.583 E.48632
G1 X86.555 Y95.583 E.01646
G1 X97.721 Y84.417 E.48632
G1 X97.187 Y84.417 E.01646
G1 X86.02 Y95.583 E.48632
G1 X85.486 Y95.583 E.01646
G1 X96.652 Y84.417 E.48632
G1 X96.118 Y84.417 E.01646
G1 X84.951 Y95.583 E.48632
G1 X84.417 Y95.583 E.01646
G1 X95.584 Y84.417 E.48632
G1 X95.049 Y84.417 E.01646
G1 X83.883 Y95.583 E.48632
G1 X83.348 Y95.583 E.01646
G1 X94.515 Y84.417 E.48632
G1 X93.98 Y84.417 E.01646
G1 X82.814 Y95.583 E.48632
G1 X82.279 Y95.583 E.01646
G1 X93.446 Y84.417 E.48632
G1 X92.911 Y84.417 E.01646
G1 X81.745 Y95.583 E.48632
G1 X81.21 Y95.583 E.01646
G1 X92.377 Y84.417 E.48632
G1 X91.842 Y84.417 E.01646
G1 X80.676 Y95.583 E.48632
G1 X80.141 Y95.583 E.01646
G1 X91.308 Y84.417 E.48632
G1 X90.773 Y84.417 E.01646
G1 X79.607 Y95.583 E.48632
G1 X79.072 Y95.583 E.01646
G1 X90.239 Y84.417 E.48632
G1 X89.704 Y84.417 E.01646
G1 X78.538 Y95.583 E.48632
G1 X78.003 Y95.583 E.01646
G1 X89.17 Y84.417 E.48632
G1 X88.636 Y84.417 E.01646
G1 X77.469 Y95.583 E.48632
G1 X76.935 Y95.583 E.01646
G1 X88.101 Y84.417 E.48632
G1 X87.567 Y84.417 E.01646
G1 X76.4 Y95.583 E.48632
G1 X75.866 Y95.583 E.01646
G1 X87.032 Y84.417 E.48632
G1 X86.498 Y84.417 E.01646
G1 X75.331 Y95.583 E.48632
G1 X74.797 Y95.583 E.01646
G1 X85.963 Y84.417 E.48632
G1 X85.429 Y84.417 E.01646
G1 X74.262 Y95.583 E.48632
G1 X73.728 Y95.583 E.01646
G1 X84.894 Y84.417 E.48632
G1 X84.36 Y84.417 E.01646
G1 X73.193 Y95.583 E.48632
G1 X72.659 Y95.583 E.01646
G1 X83.825 Y84.417 E.48632
G1 X83.291 Y84.417 E.01646
G1 X72.124 Y95.583 E.48632
G1 X71.59 Y95.583 E.01646
G1 X82.757 Y84.417 E.48632
G1 X82.222 Y84.417 E.01646
G1 X71.056 Y95.583 E.48632
G1 X70.521 Y95.583 E.01646
G1 X81.688 Y84.417 E.48632
G1 X81.153 Y84.417 E.01646
G1 X69.987 Y95.583 E.48632
G1 X69.452 Y95.583 E.01646
G1 X80.619 Y84.417 E.48632
G1 X80.084 Y84.417 E.01646
G1 X68.918 Y95.583 E.48632
G1 X68.435 Y95.583 E.01485
G1 X68.435 Y95.531 E.0016
G1 X79.55 Y84.417 E.48405
G1 X79.015 Y84.417 E.01646
G1 X68.435 Y94.997 E.46078
G1 X68.435 Y94.462 E.01646
G1 X78.481 Y84.417 E.4375
G1 X77.946 Y84.417 E.01646
G1 X68.435 Y93.928 E.41422
G1 X68.435 Y93.393 E.01646
G1 X77.412 Y84.417 E.39095
G1 X76.877 Y84.417 E.01646
G1 X68.435 Y92.859 E.36767
G1 X68.435 Y92.324 E.01646
G1 X76.343 Y84.417 E.34439
G1 X75.809 Y84.417 E.01646
G1 X68.435 Y91.79 E.32112
G1 X68.435 Y91.255 E.01646
G1 X75.274 Y84.417 E.29784
G1 X74.74 Y84.417 E.01646
G1 X68.435 Y90.721 E.27456
G1 X68.435 Y90.187 E.01646
G1 X74.205 Y84.417 E.25129
G1 X73.671 Y84.417 E.01646
G1 X68.435 Y89.652 E.22801
G1 X68.435 Y89.118 E.01646
G1 X73.136 Y84.417 E.20473
G1 X72.602 Y84.417 E.01646
G1 X68.435 Y88.583 E.18146
G1 X68.435 Y88.049 E.01646
G1 X72.067 Y84.417 E.15818
G1 X71.533 Y84.417 E.01646
G1 X68.435 Y87.514 E.1349
G1 X68.435 Y86.98 E.01646
M73 P60 R4
G1 X70.998 Y84.417 E.11163
G1 X70.464 Y84.417 E.01646
G1 X68.435 Y86.445 E.08835
G1 X68.435 Y85.911 E.01646
G1 X69.929 Y84.417 E.06507
G1 X69.395 Y84.417 E.01646
G1 X68.435 Y85.376 E.0418
G1 X68.435 Y84.842 E.01646
G1 X69.03 Y84.247 E.02591
; CHANGE_LAYER
; Z_HEIGHT: 0.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15000
G1 X68.435 Y84.842 E-.31971
G1 X68.435 Y85.376 E-.2031
G1 X68.877 Y84.935 E-.2372
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 3/15
; update layer progress
M73 L3
M991 S0 P2 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z.8 I-.301 J1.179 P1  F42000
G1 X111.898 Y95.917 Z.8
G1 Z.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z1
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    
      M400
      G90
      M83
      M204 S5000
      G0 Z2 F4000
      G0 X187 Y178 F20000
      G39 S1 X187 Y178
      G0 Z2 F4000
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
        M623
    
    M623
M623
; SKIPPABLE_END




G1 Z1.000
G1 X111.734 Y85.011 F42000
G1 Z.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42084
G1 F15000
M204 S6000
G1 X111.14 Y84.417 E.02589
G1 X110.606 Y84.417 E.01646
G1 X111.565 Y85.376 E.04177
G1 X111.565 Y85.91 E.01646
G1 X110.071 Y84.417 E.06505
G1 X109.537 Y84.417 E.01646
G1 X111.565 Y86.445 E.08833
G1 X111.565 Y86.979 E.01646
G1 X109.002 Y84.417 E.1116
G1 X108.468 Y84.417 E.01646
G1 X111.565 Y87.514 E.13488
G1 X111.565 Y88.048 E.01646
G1 X107.933 Y84.417 E.15816
G1 X107.399 Y84.417 E.01646
G1 X111.565 Y88.583 E.18143
G1 X111.565 Y89.117 E.01646
G1 X106.864 Y84.417 E.20471
G1 X106.33 Y84.417 E.01646
G1 X111.565 Y89.652 E.22799
G1 X111.565 Y90.186 E.01646
G1 X105.795 Y84.417 E.25126
G1 X105.261 Y84.417 E.01646
G1 X111.565 Y90.72 E.27454
G1 X111.565 Y91.255 E.01646
G1 X104.726 Y84.417 E.29782
G1 X104.192 Y84.417 E.01646
G1 X111.565 Y91.789 E.32109
G1 X111.565 Y92.324 E.01646
G1 X103.658 Y84.417 E.34437
G1 X103.123 Y84.417 E.01646
G1 X111.565 Y92.858 E.36765
G1 X111.565 Y93.393 E.01646
G1 X102.589 Y84.417 E.39092
G1 X102.054 Y84.417 E.01646
G1 X111.565 Y93.927 E.4142
G1 X111.565 Y94.462 E.01646
G1 X101.52 Y84.417 E.43748
G1 X100.985 Y84.417 E.01646
G1 X111.565 Y94.996 E.46075
G1 X111.565 Y95.531 E.01646
G1 X100.451 Y84.417 E.48403
G1 X99.916 Y84.417 E.01646
G1 X111.083 Y95.583 E.48632
G1 X110.548 Y95.583 E.01646
G1 X99.382 Y84.417 E.48632
G1 X98.847 Y84.417 E.01646
G1 X110.014 Y95.583 E.48632
G1 X109.479 Y95.583 E.01646
G1 X98.313 Y84.417 E.48632
G1 X97.778 Y84.417 E.01646
G1 X108.945 Y95.583 E.48632
G1 X108.411 Y95.583 E.01646
G1 X97.244 Y84.417 E.48632
G1 X96.71 Y84.417 E.01646
G1 X107.876 Y95.583 E.48632
G1 X107.342 Y95.583 E.01646
G1 X96.175 Y84.417 E.48632
G1 X95.641 Y84.417 E.01646
G1 X106.807 Y95.583 E.48632
G1 X106.273 Y95.583 E.01646
G1 X95.106 Y84.417 E.48632
G1 X94.572 Y84.417 E.01646
G1 X105.738 Y95.583 E.48632
G1 X105.204 Y95.583 E.01646
M73 P61 R4
G1 X94.037 Y84.417 E.48632
G1 X93.503 Y84.417 E.01646
G1 X104.669 Y95.583 E.48632
G1 X104.135 Y95.583 E.01646
G1 X92.968 Y84.417 E.48632
G1 X92.434 Y84.417 E.01646
G1 X103.6 Y95.583 E.48632
G1 X103.066 Y95.583 E.01646
G1 X91.899 Y84.417 E.48632
G1 X91.365 Y84.417 E.01646
G1 X102.532 Y95.583 E.48632
G1 X101.997 Y95.583 E.01646
G1 X90.831 Y84.417 E.48632
G1 X90.296 Y84.417 E.01646
G1 X101.463 Y95.583 E.48632
G1 X100.928 Y95.583 E.01646
G1 X89.762 Y84.417 E.48632
G1 X89.227 Y84.417 E.01646
G1 X100.394 Y95.583 E.48632
G1 X99.859 Y95.583 E.01646
G1 X88.693 Y84.417 E.48632
G1 X88.158 Y84.417 E.01646
G1 X99.325 Y95.583 E.48632
G1 X98.79 Y95.583 E.01646
G1 X87.624 Y84.417 E.48632
G1 X87.089 Y84.417 E.01646
G1 X98.256 Y95.583 E.48632
G1 X97.721 Y95.583 E.01646
G1 X86.555 Y84.417 E.48632
G1 X86.02 Y84.417 E.01646
G1 X97.187 Y95.583 E.48632
G1 X96.652 Y95.583 E.01646
G1 X85.486 Y84.417 E.48632
G1 X84.951 Y84.417 E.01646
G1 X96.118 Y95.583 E.48632
G1 X95.584 Y95.583 E.01646
G1 X84.417 Y84.417 E.48632
G1 X83.883 Y84.417 E.01646
G1 X95.049 Y95.583 E.48632
G1 X94.515 Y95.583 E.01646
G1 X83.348 Y84.417 E.48632
G1 X82.814 Y84.417 E.01646
G1 X93.98 Y95.583 E.48632
G1 X93.446 Y95.583 E.01646
G1 X82.279 Y84.417 E.48632
G1 X81.745 Y84.417 E.01646
G1 X92.911 Y95.583 E.48632
G1 X92.377 Y95.583 E.01646
G1 X81.21 Y84.417 E.48632
G1 X80.676 Y84.417 E.01646
G1 X91.842 Y95.583 E.48632
G1 X91.308 Y95.583 E.01646
G1 X80.141 Y84.417 E.48632
G1 X79.607 Y84.417 E.01646
G1 X90.773 Y95.583 E.48632
G1 X90.239 Y95.583 E.01646
G1 X79.072 Y84.417 E.48632
G1 X78.538 Y84.417 E.01646
G1 X89.704 Y95.583 E.48632
G1 X89.17 Y95.583 E.01646
G1 X78.003 Y84.417 E.48632
G1 X77.469 Y84.417 E.01646
G1 X88.636 Y95.583 E.48632
G1 X88.101 Y95.583 E.01646
G1 X76.935 Y84.417 E.48632
G1 X76.4 Y84.417 E.01646
G1 X87.567 Y95.583 E.48632
G1 X87.032 Y95.583 E.01646
G1 X75.866 Y84.417 E.48632
G1 X75.331 Y84.417 E.01646
G1 X86.498 Y95.583 E.48632
G1 X85.963 Y95.583 E.01646
G1 X74.797 Y84.417 E.48632
G1 X74.262 Y84.417 E.01646
G1 X85.429 Y95.583 E.48632
G1 X84.894 Y95.583 E.01646
G1 X73.728 Y84.417 E.48632
G1 X73.193 Y84.417 E.01646
G1 X84.36 Y95.583 E.48632
G1 X83.825 Y95.583 E.01646
G1 X72.659 Y84.417 E.48632
G1 X72.124 Y84.417 E.01646
G1 X83.291 Y95.583 E.48632
G1 X82.757 Y95.583 E.01646
G1 X71.59 Y84.417 E.48632
G1 X71.056 Y84.417 E.01646
G1 X82.222 Y95.583 E.48632
G1 X81.688 Y95.583 E.01646
G1 X70.521 Y84.417 E.48632
G1 X69.987 Y84.417 E.01646
G1 X81.153 Y95.583 E.48632
G1 X80.619 Y95.583 E.01646
G1 X69.452 Y84.417 E.48632
G1 X68.918 Y84.417 E.01646
G1 X80.084 Y95.583 E.48632
G1 X79.55 Y95.583 E.01646
G1 X68.435 Y84.469 E.48405
G1 X68.435 Y85.003 E.01646
G1 X79.015 Y95.583 E.46078
G1 X78.481 Y95.583 E.01646
G1 X68.435 Y85.538 E.4375
G1 X68.435 Y86.072 E.01646
G1 X77.946 Y95.583 E.41422
G1 X77.412 Y95.583 E.01646
G1 X68.435 Y86.607 E.39095
G1 X68.435 Y87.141 E.01646
G1 X76.877 Y95.583 E.36767
G1 X76.343 Y95.583 E.01646
G1 X68.435 Y87.676 E.34439
G1 X68.435 Y88.21 E.01646
G1 X75.809 Y95.583 E.32112
G1 X75.274 Y95.583 E.01646
G1 X68.435 Y88.745 E.29784
G1 X68.435 Y89.279 E.01646
G1 X74.74 Y95.583 E.27456
M73 P62 R4
G1 X74.205 Y95.583 E.01646
G1 X68.435 Y89.813 E.25129
G1 X68.435 Y90.348 E.01646
G1 X73.671 Y95.583 E.22801
G1 X73.136 Y95.583 E.01646
G1 X68.435 Y90.882 E.20473
G1 X68.435 Y91.417 E.01646
G1 X72.602 Y95.583 E.18146
G1 X72.067 Y95.583 E.01646
G1 X68.435 Y91.951 E.15818
G1 X68.435 Y92.486 E.01646
G1 X71.533 Y95.583 E.1349
G1 X70.998 Y95.583 E.01646
G1 X68.435 Y93.02 E.11163
G1 X68.435 Y93.555 E.01646
G1 X70.464 Y95.583 E.08835
G1 X69.929 Y95.583 E.01646
G1 X68.435 Y94.089 E.06507
G1 X68.435 Y94.624 E.01646
G1 X69.395 Y95.583 E.0418
G1 X68.861 Y95.583 E.01646
G1 X68.266 Y94.988 E.02591
; CHANGE_LAYER
; Z_HEIGHT: 0.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15000
G1 X68.861 Y95.583 E-.31971
G1 X69.395 Y95.583 E-.2031
G1 X68.954 Y95.142 E-.2372
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 4/15
; update layer progress
M73 L4
M991 S0 P3 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z1 I-.022 J1.217 P1  F42000
G1 X111.898 Y95.917 Z1
G1 Z.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F5383
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F5383
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
G1 F12000
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.2 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z1.2
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z1.2 F4000
            G39.3 S1
            G0 Z1.2 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X68.45 Y94.569 F42000
G1 Z.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F5383
M204 S6000
G1 X68.45 Y95.568 E.03313
G1 X69.08 Y95.568 E.02088
G1 X80.216 Y84.432 E.52244
G1 X76.756 Y84.432 E.11479
G1 X87.892 Y95.568 E.52244
G1 X84.432 Y95.568 E.11479
G1 X95.568 Y84.432 E.52244
G1 X92.108 Y84.432 E.11479
G1 X103.244 Y95.568 E.52244
G1 X99.784 Y95.568 E.11479
G1 X110.92 Y84.432 E.52244
G1 X107.46 Y84.432 E.11479
G1 X111.55 Y88.522 E.19187
G1 X111.55 Y91.478 E.09807
G1 X107.46 Y95.568 E.19187
G1 X110.92 Y95.568 E.11479
G1 X99.784 Y84.432 E.52244
G1 X103.244 Y84.432 E.11479
G1 X92.108 Y95.568 E.52244
G1 X95.568 Y95.568 E.11479
G1 X84.432 Y84.432 E.52244
G1 X87.892 Y84.432 E.11479
G1 X76.756 Y95.568 E.52244
G1 X80.216 Y95.568 E.11479
G1 X69.08 Y84.432 E.52244
G1 X72.54 Y84.432 E.11479
G1 X68.45 Y88.522 E.19187
G1 X68.45 Y91.478 E.09807
G1 X72.54 Y95.568 E.19187
G1 X74.169 Y95.568 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1
; LAYER_HEIGHT: 0.2
; WIPE_START
M73 P63 R4
G1 F15476.087
G1 X72.54 Y95.568 E-.61876
G1 X72.278 Y95.305 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 5/15
; update layer progress
M73 L5
M991 S0 P4 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z1.2 I-.019 J1.217 P1  F42000
G1 X111.898 Y95.917 Z1.2
G1 Z1
G1 E.8 F1800
; FEATURE: Inner wall
G1 F8508
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F8508
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
G1 F12000
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.4 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z1.4
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z1.4 F4000
            G39.3 S1
            G0 Z1.4 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X111.535 Y93.599 F42000
G1 Z1
G1 E.8 F1800
; Slow Down Start
; FEATURE: Floating vertical shell
; LINE_WIDTH: 0.385657
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X111.535 Y95.395 E.05014
G1 X111.508 Y95.526 E.00376
G1 X111.376 Y95.554 E.00376
G1 X101.763 Y95.554 E.26846
; Slow Down End
M204 S10000
G1 X111.535 Y91.986 F42000
; Slow Down Start
; LINE_WIDTH: 0.38292
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X111.535 Y85.394 E.18265
; Slow Down End
M204 S10000
G1 X110.648 Y84.446 F42000
G1 F8508
M204 S6000
G1 X109.7 Y84.446 E.02627
M204 S10000
G1 X108.92 Y84.446 F42000
; Slow Down Start
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X92.406 Y84.446 E.45755
G1 X92.26 Y84.536 E.00474
G1 X91.98 Y84.446 E.00814
G1 X83.173 Y84.446 E.244
G1 X82.977 Y84.518 E.0058
G1 X82.75 Y84.446 E.00659
G1 X81.171 Y84.446 E.04375
; Slow Down End
M204 S10000
G1 X80.392 Y84.446 F42000
; Slow Down Start
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X79.206 Y84.446 E.03285
G1 X79.009 Y84.518 E.0058
G1 X78.783 Y84.446 E.00659
G1 X75.202 Y84.446 E.09921
; Slow Down End
M204 S10000
G1 X74.422 Y84.446 F42000
; Slow Down Start
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X73.224 Y84.446 E.03322
G1 X73.027 Y84.518 E.0058
G1 X72.8 Y84.446 E.00659
G1 X70.811 Y84.446 E.05512
; Slow Down End
M204 S10000
G1 X68.827 Y93.484 F42000
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F8508
M204 S6000
G1 X68.827 Y91.855 E.05401
G1 X72.163 Y95.191 E.15649
G1 X69.457 Y95.191 E.08977
G1 X79.839 Y84.809 E.48705
M73 P64 R4
G1 X77.133 Y84.809 E.08977
G1 X87.515 Y95.191 E.48705
G1 X84.809 Y95.191 E.08977
G1 X95.191 Y84.809 E.48705
G1 X92.485 Y84.809 E.08977
G1 X102.867 Y95.191 E.48705
G1 X100.161 Y95.191 E.08977
G1 X110.543 Y84.809 E.48705
G1 X107.837 Y84.809 E.08977
G1 X111.173 Y88.145 E.15649
G1 X111.173 Y91.855 E.12309
G1 X107.837 Y95.191 E.15649
G1 X110.543 Y95.191 E.08977
G1 X100.161 Y84.809 E.48705
G1 X102.867 Y84.809 E.08977
G1 X92.485 Y95.191 E.48705
G1 X95.191 Y95.191 E.08977
G1 X84.809 Y84.809 E.48705
G1 X87.515 Y84.809 E.08977
G1 X77.133 Y95.191 E.48705
G1 X79.839 Y95.191 E.08977
G1 X69.08 Y84.432 E.50474
G1 X70.33 Y84.432 E.04146
G1 X70.535 Y84.809 E.01425
G1 X72.163 Y84.809 E.054
G1 X68.827 Y88.145 E.15649
G1 X68.827 Y87.291 E.02833
G1 X68.45 Y87.668 E.01769
G1 X68.45 Y87.427 E.00799
M204 S10000
G1 X69.569 Y95.554 F42000
; Slow Down Start
; FEATURE: Floating vertical shell
; LINE_WIDTH: 0.383183
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X68.492 Y95.526 E.02987
G1 X68.465 Y95.395 E.00374
G1 X68.465 Y88.12 E.2017
; Slow Down End
M204 S10000
G1 X70.387 Y95.554 F42000
; Slow Down Start
; LINE_WIDTH: 0.38292
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X79.078 Y95.554 E.24079
G1 X79.228 Y95.447 E.00509
G1 X79.532 Y95.554 E.00892
G1 X94.484 Y95.554 E.41424
G3 X94.725 Y95.554 I.121 J.389 E.00678
G1 X100.517 Y95.554 E.16048
; Slow Down End
M106 S255
; CHANGE_LAYER
; Z_HEIGHT: 1.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F3000
G1 X98.517 Y95.554 E-.76
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 6/15
; update layer progress
M73 L6
M991 S0 P5 ;notify layer change
M106 S255
; OBJECT_ID: 110
M204 S10000
G17
G3 Z1.4 I-.033 J1.217 P1  F42000
G1 X111.898 Y95.917 Z1.4
G1 Z1.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
M73 P64 R3
G1 F15476.087
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.6 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z1.6
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z1.6 F4000
            G39.3 S1
            G0 Z1.6 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X111.731 Y85.626 F42000
G1 Z1.2
G1 E.8 F1800
; FEATURE: Bridge
; LINE_WIDTH: 0.40416
; LAYER_HEIGHT: 0.4
G1 F3000
M204 S6000
G1 X110.558 Y84.453 E.08668
G1 X109.916 Y84.453 E.03357
G1 X111.528 Y86.065 E.11919
G1 X111.528 Y86.708 E.03357
G1 X109.706 Y84.885 E.13473
G1 X109.706 Y85.325 E.02299
G1 X108.834 Y84.453 E.06444
G1 X108.631 Y84.453 E.01059
G1 X111.528 Y87.35 E.21414
G1 X111.528 Y87.992 E.03357
G1 X107.989 Y84.453 E.26162
G1 X107.347 Y84.453 E.03357
G1 X111.528 Y88.635 E.3091
G1 X111.528 Y89.277 E.03357
G1 X106.705 Y84.453 E.35658
G1 X106.062 Y84.453 E.03357
G1 X111.528 Y89.919 E.40406
G1 X111.528 Y90.561 E.03357
G1 X105.42 Y84.453 E.45154
G1 X104.778 Y84.453 E.03357
G1 X111.528 Y91.204 E.49901
G1 X111.528 Y91.846 E.03357
G1 X104.135 Y84.453 E.54649
G1 X103.493 Y84.453 E.03357
G1 X111.158 Y92.118 E.56659
G1 X110.843 Y92.433 E.02331
G1 X110.856 Y92.458 E.00146
G1 X102.851 Y84.453 E.59172
G1 X102.209 Y84.453 E.03357
G1 X111.528 Y93.773 E.68893
G1 X111.528 Y94.415 E.03357
G1 X101.566 Y84.453 E.7364
G1 X100.924 Y84.453 E.03357
M73 P65 R3
G1 X111.528 Y95.057 E.78388
G1 X111.528 Y95.547 E.02559
G1 X111.376 Y95.547 E.00798
G1 X100.282 Y84.453 E.82007
G1 X99.64 Y84.453 E.03357
G1 X110.733 Y95.547 E.82007
G1 X110.091 Y95.547 E.03357
G1 X98.997 Y84.453 E.82007
G1 X98.355 Y84.453 E.03357
G1 X109.449 Y95.547 E.82007
G1 X108.806 Y95.547 E.03357
G1 X97.713 Y84.453 E.82007
G1 X97.07 Y84.453 E.03357
G1 X108.164 Y95.547 E.82007
G1 X107.522 Y95.547 E.03357
G1 X96.428 Y84.453 E.82007
G1 X95.786 Y84.453 E.03357
G1 X106.88 Y95.547 E.82007
G1 X106.237 Y95.547 E.03357
G1 X95.144 Y84.453 E.82007
G1 X94.501 Y84.453 E.03357
G1 X105.595 Y95.547 E.82007
G1 X104.953 Y95.547 E.03357
G1 X93.859 Y84.453 E.82007
G1 X93.217 Y84.453 E.03357
G1 X104.311 Y95.547 E.82007
G1 X103.668 Y95.547 E.03357
G1 X92.574 Y84.453 E.82007
G1 X92.484 Y84.453 E.00474
G1 X92.542 Y84.603 E.00839
G1 X92.263 Y84.784 E.01737
G1 X103.026 Y95.547 E.79559
G1 X102.384 Y95.547 E.03357
G1 X91.29 Y84.453 E.82007
G1 X90.648 Y84.453 E.03357
G1 X100.897 Y94.703 E.75766
G1 X100.576 Y95.024 E.02374
G1 X90.005 Y84.453 E.7814
G1 X89.363 Y84.453 E.03357
G1 X100.457 Y95.547 E.82007
G1 X99.815 Y95.547 E.03357
G1 X88.721 Y84.453 E.82007
G1 X88.079 Y84.453 E.03357
G1 X99.172 Y95.547 E.82007
G1 X98.53 Y95.547 E.03357
G1 X87.436 Y84.453 E.82007
G1 X86.794 Y84.453 E.03357
G1 X97.888 Y95.547 E.82007
G1 X97.245 Y95.547 E.03357
G1 X86.152 Y84.453 E.82007
G1 X85.509 Y84.453 E.03357
G1 X96.603 Y95.547 E.82007
G1 X95.961 Y95.547 E.03357
G1 X84.867 Y84.453 E.82007
G1 X84.225 Y84.453 E.03357
G1 X95.319 Y95.547 E.82007
G1 X94.849 Y95.547 E.02457
G1 X94.567 Y95.363 E.01759
G1 X94.526 Y95.396 E.00276
G1 X83.583 Y84.453 E.80894
M73 P66 R3
G1 X83.26 Y84.453 E.01687
G1 X83.1 Y84.613 E.01181
G1 X94.034 Y95.547 E.80826
G1 X93.392 Y95.547 E.03357
G1 X82.298 Y84.453 E.82007
G1 X81.656 Y84.453 E.03357
G1 X92.75 Y95.547 E.82007
G1 X92.107 Y95.547 E.03357
G1 X81.177 Y84.617 E.80799
G1 X81.177 Y85.259 E.03357
G1 X91.465 Y95.547 E.76051
G1 X90.823 Y95.547 E.03357
G1 X79.729 Y84.453 E.82007
G1 X79.292 Y84.453 E.02282
G1 X79.189 Y84.556 E.0076
G1 X90.18 Y95.547 E.81247
G1 X89.538 Y95.547 E.03357
G1 X78.444 Y84.453 E.82007
G1 X77.802 Y84.453 E.03357
G1 X88.896 Y95.547 E.82007
G1 X88.254 Y95.547 E.03357
G1 X77.16 Y84.453 E.82007
G1 X76.517 Y84.453 E.03357
G1 X87.611 Y95.547 E.82007
G1 X86.969 Y95.547 E.03357
G1 X75.875 Y84.453 E.82007
G1 X75.233 Y84.453 E.03357
G1 X86.327 Y95.547 E.82007
G1 X85.684 Y95.547 E.03357
G1 X75.208 Y85.07 E.77445
G1 X75.208 Y85.325 E.01331
G1 X74.336 Y84.453 E.06444
G1 X73.948 Y84.453 E.02026
G1 X85.042 Y95.547 E.82007
G1 X84.4 Y95.547 E.03357
G1 X73.308 Y84.455 E.81993
G1 X73.012 Y84.751 E.02189
G1 X72.714 Y84.453 E.02204
G1 X72.664 Y84.453 E.00261
G1 X83.758 Y95.547 E.82007
G1 X83.115 Y95.547 E.03357
G1 X72.022 Y84.453 E.82007
G1 X71.379 Y84.453 E.03357
G1 X82.473 Y95.547 E.82007
G1 X81.831 Y95.547 E.03357
G1 X70.941 Y84.657 E.805
M73 P67 R3
G1 X71.339 Y85.386 E.0434
G1 X71.183 Y85.541 E.0115
G1 X81.188 Y95.547 E.73962
G1 X80.546 Y95.547 E.03357
G1 X70.862 Y85.863 E.71588
G1 X70.541 Y86.184 E.02374
G1 X79.904 Y95.547 E.69215
G1 X79.625 Y95.547 E.01458
G1 X79.193 Y95.115 E.03195
G1 X78.99 Y95.276 E.01352
G1 X70.22 Y86.505 E.64834
G1 X69.898 Y86.826 E.02374
G1 X78.619 Y95.547 E.64467
G1 X77.977 Y95.547 E.03357
G1 X74.11 Y91.68 E.28587
G1 X74.605 Y91.679 E.0259
G1 X73.911 Y90.985 E.05132
G1 X73.663 Y91.233 E.01834
G1 X69.577 Y87.147 E.30203
G1 X69.256 Y87.468 E.02374
G1 X77.335 Y95.547 E.59719
G1 X76.693 Y95.547 E.03357
G1 X68.935 Y87.789 E.57345
G1 X68.608 Y88.105 E.02374
G1 X76.05 Y95.547 E.55015
G1 X75.408 Y95.547 E.03357
G1 X68.472 Y88.611 E.51274
G1 X68.472 Y89.253 E.03357
G1 X74.766 Y95.547 E.46526
G1 X74.123 Y95.547 E.03357
G1 X68.472 Y89.895 E.41778
G1 X68.472 Y90.537 E.03357
G1 X73.481 Y95.547 E.37031
G1 X72.839 Y95.547 E.03357
G1 X68.472 Y91.18 E.32283
G1 X68.472 Y91.822 E.03357
G1 X72.197 Y95.547 E.27535
G1 X71.554 Y95.547 E.03357
G1 X68.472 Y92.464 E.22787
G1 X68.472 Y93.107 E.03357
G1 X70.912 Y95.547 E.18039
G1 X70.474 Y95.547 E.0229
G1 X69.911 Y94.984 E.04158
G1 X69.809 Y95.087 E.00755
G1 X68.472 Y93.749 E.09888
G1 X68.472 Y94.391 E.03357
G1 X69.515 Y95.435 E.07713
M73 P68 R3
G1 X69.504 Y95.547 E.0059
G1 X68.985 Y95.547 E.0271
G1 X68.269 Y94.831 E.05293
M106 S191.25
M204 S10000
G1 X69.08 Y84.432 F42000
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
; LAYER_HEIGHT: 0.2
G1 F15476.087
M204 S6000
G1 X70.383 Y85.735 E.06114
; CHANGE_LAYER
; Z_HEIGHT: 1.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15476.087
G1 X69.08 Y84.432 E-.76
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 7/15
; update layer progress
M73 L7
M991 S0 P6 ;notify layer change
M106 S201.45
; OBJECT_ID: 110
M204 S10000
G17
G3 Z1.6 I-.315 J1.175 P1  F42000
G1 X111.898 Y95.917 Z1.6
G1 Z1.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F15476.087
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.8 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z1.8
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z1.8 F4000
            G39.3 S1
            G0 Z1.8 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X111.55 Y85.431 F42000
G1 Z1.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X111.55 Y84.432 E.03313
G1 X110.92 Y84.432 E.02088
G1 X110.582 Y84.769 E.01584
G1 X110.582 Y87.555 E.09239
G1 X111.55 Y88.522 E.04537
G1 X111.55 Y91.478 E.09807
G1 X110.582 Y92.445 E.04537
G1 X110.582 Y95.231 E.09239
G1 X110.92 Y95.568 E.01584
G1 X111.55 Y95.568 E.02088
G1 X111.55 Y94.569 E.03313
M204 S10000
G1 X110.36 Y85.056 F42000
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42216
G1 F15000
M204 S6000
G1 X109.72 Y84.417 E.02796
G1 X109.184 Y84.417 E.01657
G1 X110.19 Y85.423 E.04399
G1 X110.19 Y85.959 E.01657
G1 X108.648 Y84.417 E.06743
G1 X108.111 Y84.417 E.01657
G1 X110.19 Y86.496 E.09087
G1 X110.19 Y87.032 E.01657
G1 X107.575 Y84.417 E.1143
G1 X107.039 Y84.417 E.01657
G1 X110.19 Y87.568 E.13774
G1 X110.19 Y88.105 E.01657
G1 X106.502 Y84.417 E.16118
G1 X105.966 Y84.417 E.01657
G1 X110.19 Y88.641 E.18462
G1 X110.19 Y89.177 E.01657
G1 X105.43 Y84.417 E.20806
G1 X104.893 Y84.417 E.01657
G1 X110.19 Y89.714 E.2315
G1 X110.19 Y90.25 E.01657
G1 X104.357 Y84.417 E.25494
G1 X103.821 Y84.417 E.01657
G1 X110.19 Y90.786 E.27838
G1 X110.19 Y91.323 E.01657
G1 X103.284 Y84.417 E.30182
G1 X102.748 Y84.417 E.01657
G1 X110.19 Y91.859 E.32526
G1 X110.19 Y92.395 E.01657
G1 X102.212 Y84.417 E.3487
G1 X101.675 Y84.417 E.01657
G1 X110.19 Y92.932 E.37214
G1 X110.19 Y93.468 E.01657
G1 X101.139 Y84.417 E.39558
G1 X100.603 Y84.417 E.01657
G1 X110.19 Y94.004 E.41902
G1 X110.19 Y94.541 E.01657
G1 X100.066 Y84.417 E.44246
G1 X99.53 Y84.417 E.01657
G1 X110.19 Y95.077 E.4659
G1 X110.19 Y95.583 E.01565
G1 X110.16 Y95.583 E.00092
M73 P69 R3
G1 X98.994 Y84.417 E.48803
G1 X98.457 Y84.417 E.01657
G1 X109.624 Y95.583 E.48803
G1 X109.088 Y95.583 E.01657
G1 X97.921 Y84.417 E.48803
G1 X97.385 Y84.417 E.01657
G1 X108.551 Y95.583 E.48803
G1 X108.015 Y95.583 E.01657
G1 X96.848 Y84.417 E.48803
G1 X96.312 Y84.417 E.01657
G1 X107.479 Y95.583 E.48803
G1 X106.942 Y95.583 E.01657
G1 X95.776 Y84.417 E.48803
G1 X95.239 Y84.417 E.01657
G1 X106.406 Y95.583 E.48803
G1 X105.87 Y95.583 E.01657
G1 X94.703 Y84.417 E.48803
G1 X94.167 Y84.417 E.01657
G1 X105.333 Y95.583 E.48803
G1 X104.797 Y95.583 E.01657
G1 X93.63 Y84.417 E.48803
G1 X93.094 Y84.417 E.01657
G1 X104.261 Y95.583 E.48803
G1 X103.724 Y95.583 E.01657
G1 X92.558 Y84.417 E.48803
G1 X92.021 Y84.417 E.01657
G1 X103.188 Y95.583 E.48803
G1 X102.652 Y95.583 E.01657
G1 X91.485 Y84.417 E.48803
G1 X90.949 Y84.417 E.01657
G1 X102.116 Y95.583 E.48803
G1 X101.579 Y95.583 E.01657
G1 X90.412 Y84.417 E.48803
G1 X89.876 Y84.417 E.01657
G1 X101.043 Y95.583 E.48803
G1 X100.507 Y95.583 E.01657
G1 X89.34 Y84.417 E.48803
G1 X88.803 Y84.417 E.01657
G1 X99.97 Y95.583 E.48803
G1 X99.434 Y95.583 E.01657
G1 X88.267 Y84.417 E.48803
G1 X87.731 Y84.417 E.01657
G1 X98.898 Y95.583 E.48803
G1 X98.361 Y95.583 E.01657
G1 X87.194 Y84.417 E.48803
G1 X86.658 Y84.417 E.01657
G1 X97.825 Y95.583 E.48803
G1 X97.289 Y95.583 E.01657
G1 X86.122 Y84.417 E.48803
G1 X85.585 Y84.417 E.01657
G1 X96.752 Y95.583 E.48803
G1 X96.216 Y95.583 E.01657
G1 X85.049 Y84.417 E.48803
G1 X84.513 Y84.417 E.01657
G1 X95.68 Y95.583 E.48803
G1 X95.143 Y95.583 E.01657
G1 X83.977 Y84.417 E.48803
G1 X83.44 Y84.417 E.01657
G1 X94.607 Y95.583 E.48803
G1 X94.071 Y95.583 E.01657
G1 X82.904 Y84.417 E.48803
G1 X82.368 Y84.417 E.01657
G1 X93.534 Y95.583 E.48803
G1 X92.998 Y95.583 E.01657
G1 X81.831 Y84.417 E.48803
G1 X81.295 Y84.417 E.01657
G1 X92.462 Y95.583 E.48803
G1 X91.925 Y95.583 E.01657
G1 X80.759 Y84.417 E.48803
G1 X80.222 Y84.417 E.01657
G1 X91.389 Y95.583 E.48803
G1 X90.853 Y95.583 E.01657
G1 X79.686 Y84.417 E.48803
G1 X79.15 Y84.417 E.01657
G1 X90.316 Y95.583 E.48803
G1 X89.78 Y95.583 E.01657
G1 X78.613 Y84.417 E.48803
G1 X78.077 Y84.417 E.01657
G1 X89.244 Y95.583 E.48803
G1 X88.707 Y95.583 E.01657
G1 X77.541 Y84.417 E.48803
G1 X77.004 Y84.417 E.01657
G1 X88.171 Y95.583 E.48803
G1 X87.635 Y95.583 E.01657
G1 X76.468 Y84.417 E.48803
G1 X75.932 Y84.417 E.01657
G1 X87.098 Y95.583 E.48803
G1 X86.562 Y95.583 E.01657
G1 X75.395 Y84.417 E.48803
G1 X74.859 Y84.417 E.01657
G1 X86.026 Y95.583 E.48803
G1 X85.489 Y95.583 E.01657
G1 X74.323 Y84.417 E.48803
G1 X73.786 Y84.417 E.01657
G1 X84.953 Y95.583 E.48803
G1 X84.417 Y95.583 E.01657
G1 X73.25 Y84.417 E.48803
G1 X72.714 Y84.417 E.01657
G1 X83.88 Y95.583 E.48803
G1 X83.344 Y95.583 E.01657
G1 X72.272 Y84.511 E.48391
G1 X72.272 Y85.047 E.01657
G1 X82.808 Y95.583 E.46047
G1 X82.271 Y95.583 E.01657
G1 X72.272 Y85.584 E.43703
G1 X72.272 Y86.12 E.01657
G1 X81.735 Y95.583 E.41359
G1 X81.199 Y95.583 E.01657
G1 X72.272 Y86.656 E.39015
G1 X72.272 Y87.193 E.01657
G1 X80.662 Y95.583 E.36671
G1 X80.126 Y95.583 E.01657
G1 X72.272 Y87.729 E.34327
G1 X72.272 Y88.265 E.01657
G1 X79.59 Y95.583 E.31983
G1 X79.053 Y95.583 E.01657
G1 X72.122 Y88.652 E.30293
G1 X71.934 Y89 E.01223
G1 X78.517 Y95.583 E.2877
G1 X77.981 Y95.583 E.01657
G1 X71.746 Y89.349 E.27247
G1 X71.558 Y89.697 E.01223
G1 X77.444 Y95.583 E.25725
G1 X76.908 Y95.583 E.01657
G1 X71.37 Y90.046 E.24202
G1 X71.183 Y90.394 E.01223
G1 X76.372 Y95.583 E.22679
M73 P70 R3
G1 X75.836 Y95.583 E.01657
G1 X70.995 Y90.742 E.21157
G1 X70.807 Y91.091 E.01223
G1 X75.299 Y95.583 E.19634
G1 X74.763 Y95.583 E.01657
G1 X70.619 Y91.439 E.18111
G1 X70.431 Y91.788 E.01223
G1 X74.227 Y95.583 E.16588
G1 X73.69 Y95.583 E.01657
G1 X70.243 Y92.136 E.15066
G1 X70.055 Y92.485 E.01223
G1 X73.154 Y95.583 E.13543
G1 X72.618 Y95.583 E.01657
G1 X69.867 Y92.833 E.1202
G1 X69.679 Y93.181 E.01223
G1 X72.081 Y95.583 E.10498
G1 X71.545 Y95.583 E.01657
G1 X69.491 Y93.53 E.08975
G1 X69.303 Y93.878 E.01223
G1 X71.009 Y95.583 E.07452
G1 X70.472 Y95.583 E.01657
G1 X69.116 Y94.227 E.05929
G1 X68.928 Y94.575 E.01223
G1 X69.936 Y95.583 E.04407
G1 X69.4 Y95.583 E.01657
G1 X68.74 Y94.923 E.02884
G1 X68.552 Y95.272 E.01223
G1 X69.033 Y95.753 E.02103
M204 S10000
G1 X70.329 Y91.151 F42000
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X69.556 Y92.584 E.05401
G1 X68.45 Y91.478 E.05187
G1 X68.45 Y88.522 E.09807
G1 X71.879 Y85.093 E.16087
G1 X71.879 Y87.231 E.07094
G1 X69.08 Y84.432 E.13134
G1 X68.45 Y84.432 E.02088
G1 X68.45 Y85.431 E.03313
; CHANGE_LAYER
; Z_HEIGHT: 1.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15476.087
G1 X68.45 Y84.432 E-.37956
G1 X69.08 Y84.432 E-.23921
G1 X69.343 Y84.695 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 8/15
; update layer progress
M73 L8
M991 S0 P7 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z1.8 I-.31 J1.177 P1  F42000
G1 X111.898 Y95.917 Z1.8
G1 Z1.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F15476.087
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z2
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z2 F4000
            G39.3 S1
            G0 Z2 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X109.552 Y95.753 F42000
G1 Z1.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42121
G1 F15000
M204 S6000
G1 X110.19 Y95.115 E.0278
G1 X110.19 Y94.58 E.01649
G1 X109.187 Y95.583 E.04373
G1 X108.652 Y95.583 E.01649
G1 X110.19 Y94.045 E.06705
G1 X110.19 Y93.51 E.01649
G1 X108.117 Y95.583 E.09037
G1 X107.582 Y95.583 E.01649
G1 X110.19 Y92.975 E.11369
G1 X110.19 Y92.44 E.01649
G1 X107.047 Y95.583 E.13702
G1 X106.512 Y95.583 E.01649
G1 X110.19 Y91.905 E.16034
G1 X110.19 Y91.37 E.01649
G1 X105.977 Y95.583 E.18366
G1 X105.442 Y95.583 E.01649
G1 X110.19 Y90.835 E.20698
G1 X110.19 Y90.3 E.01649
G1 X104.907 Y95.583 E.2303
G1 X104.372 Y95.583 E.01649
G1 X110.19 Y89.765 E.25363
G1 X110.19 Y89.23 E.01649
G1 X103.837 Y95.583 E.27695
G1 X103.302 Y95.583 E.01649
G1 X110.19 Y88.695 E.30027
G1 X110.19 Y88.16 E.01649
G1 X102.767 Y95.583 E.32359
G1 X102.232 Y95.583 E.01649
G1 X110.19 Y87.625 E.34691
G1 X110.19 Y87.09 E.01649
G1 X101.697 Y95.583 E.37024
G1 X101.162 Y95.583 E.01649
G1 X110.19 Y86.556 E.39356
G1 X110.19 Y86.021 E.01649
G1 X100.627 Y95.583 E.41688
G1 X100.092 Y95.583 E.01649
G1 X110.19 Y85.486 E.4402
G1 X110.19 Y84.951 E.01649
G1 X99.557 Y95.583 E.46353
G1 X99.023 Y95.583 E.01649
G1 X110.189 Y84.417 E.4868
G1 X109.654 Y84.417 E.01649
G1 X98.488 Y95.583 E.4868
G1 X97.953 Y95.583 E.01649
G1 X109.119 Y84.417 E.4868
G1 X108.584 Y84.417 E.01649
G1 X97.418 Y95.583 E.4868
G1 X96.883 Y95.583 E.01649
G1 X108.049 Y84.417 E.4868
G1 X107.514 Y84.417 E.01649
G1 X96.348 Y95.583 E.4868
G1 X95.813 Y95.583 E.01649
M73 P71 R3
G1 X106.979 Y84.417 E.4868
G1 X106.444 Y84.417 E.01649
G1 X95.278 Y95.583 E.4868
G1 X94.743 Y95.583 E.01649
G1 X105.909 Y84.417 E.4868
G1 X105.374 Y84.417 E.01649
G1 X94.208 Y95.583 E.4868
G1 X93.673 Y95.583 E.01649
G1 X104.839 Y84.417 E.4868
G1 X104.304 Y84.417 E.01649
G1 X93.138 Y95.583 E.4868
G1 X92.603 Y95.583 E.01649
G1 X103.769 Y84.417 E.4868
G1 X103.234 Y84.417 E.01649
G1 X92.068 Y95.583 E.4868
G1 X91.533 Y95.583 E.01649
G1 X102.699 Y84.417 E.4868
G1 X102.164 Y84.417 E.01649
G1 X90.998 Y95.583 E.4868
G1 X90.463 Y95.583 E.01649
G1 X101.629 Y84.417 E.4868
G1 X101.094 Y84.417 E.01649
G1 X89.928 Y95.583 E.4868
G1 X89.393 Y95.583 E.01649
G1 X100.559 Y84.417 E.4868
G1 X100.024 Y84.417 E.01649
G1 X88.858 Y95.583 E.4868
G1 X88.323 Y95.583 E.01649
G1 X99.489 Y84.417 E.4868
G1 X98.954 Y84.417 E.01649
G1 X87.788 Y95.583 E.4868
G1 X87.253 Y95.583 E.01649
G1 X98.419 Y84.417 E.4868
G1 X97.884 Y84.417 E.01649
G1 X86.718 Y95.583 E.4868
G1 X86.183 Y95.583 E.01649
G1 X97.349 Y84.417 E.4868
G1 X96.814 Y84.417 E.01649
G1 X85.648 Y95.583 E.4868
G1 X85.113 Y95.583 E.01649
G1 X96.279 Y84.417 E.4868
G1 X95.745 Y84.417 E.01649
G1 X84.578 Y95.583 E.4868
G1 X84.043 Y95.583 E.01649
G1 X95.21 Y84.417 E.4868
G1 X94.675 Y84.417 E.01649
G1 X83.508 Y95.583 E.4868
G1 X82.973 Y95.583 E.01649
G1 X94.14 Y84.417 E.4868
G1 X93.605 Y84.417 E.01649
G1 X82.438 Y95.583 E.4868
G1 X81.903 Y95.583 E.01649
G1 X93.07 Y84.417 E.4868
G1 X92.535 Y84.417 E.01649
G1 X81.368 Y95.583 E.4868
G1 X80.833 Y95.583 E.01649
G1 X92 Y84.417 E.4868
G1 X91.465 Y84.417 E.01649
G1 X80.298 Y95.583 E.4868
G1 X79.763 Y95.583 E.01649
G1 X90.93 Y84.417 E.4868
G1 X90.395 Y84.417 E.01649
G1 X79.228 Y95.583 E.4868
G1 X78.693 Y95.583 E.01649
G1 X89.86 Y84.417 E.4868
G1 X89.325 Y84.417 E.01649
G1 X78.158 Y95.583 E.4868
G1 X77.623 Y95.583 E.01649
G1 X88.79 Y84.417 E.4868
G1 X88.255 Y84.417 E.01649
G1 X77.088 Y95.583 E.4868
G1 X76.553 Y95.583 E.01649
G1 X87.72 Y84.417 E.4868
G1 X87.185 Y84.417 E.01649
G1 X76.018 Y95.583 E.4868
G1 X75.483 Y95.583 E.01649
G1 X86.65 Y84.417 E.4868
G1 X86.115 Y84.417 E.01649
G1 X74.948 Y95.583 E.4868
G1 X74.413 Y95.583 E.01649
G1 X85.58 Y84.417 E.4868
G1 X85.045 Y84.417 E.01649
G1 X73.878 Y95.583 E.4868
G1 X73.343 Y95.583 E.01649
G1 X84.51 Y84.417 E.4868
G1 X83.975 Y84.417 E.01649
G1 X72.808 Y95.583 E.4868
G1 X72.273 Y95.583 E.01649
G1 X83.44 Y84.417 E.4868
G1 X82.905 Y84.417 E.01649
G1 X71.738 Y95.583 E.4868
G1 X71.203 Y95.583 E.01649
G1 X82.37 Y84.417 E.4868
G1 X81.835 Y84.417 E.01649
G1 X70.668 Y95.583 E.4868
G1 X70.133 Y95.583 E.01649
G1 X81.3 Y84.417 E.4868
G1 X80.765 Y84.417 E.01649
G1 X69.598 Y95.583 E.4868
G1 X69.063 Y95.583 E.01649
G1 X80.23 Y84.417 E.4868
G1 X79.695 Y84.417 E.01649
G1 X68.528 Y95.583 E.4868
G1 X68.435 Y95.583 E.00287
G1 X68.435 Y95.341 E.00746
G3 X68.545 Y95.284 I.168 J.189 E.00385
G1 X68.841 Y94.736 E.01922
G1 X79.16 Y84.417 E.44985
G1 X78.625 Y84.417 E.01649
G1 X69.467 Y93.574 E.39922
G1 X70.094 Y92.413 E.04067
G1 X78.09 Y84.417 E.3486
G1 X77.555 Y84.417 E.01649
G1 X70.72 Y91.252 E.29797
G1 X71.346 Y90.09 E.04067
G1 X77.02 Y84.417 E.24734
G1 X76.485 Y84.417 E.01649
G1 X71.973 Y88.929 E.19671
G1 X72.251 Y88.414 E.01804
G2 X72.272 Y88.095 I-.62 J-.201 E.00995
G1 X75.95 Y84.417 E.16036
M73 P72 R3
G1 X75.415 Y84.417 E.01649
G1 X72.272 Y87.56 E.13704
G1 X72.272 Y87.025 E.01649
G1 X74.88 Y84.417 E.11371
G1 X74.345 Y84.417 E.01649
G1 X72.272 Y86.49 E.09039
G1 X72.272 Y85.955 E.01649
G1 X73.81 Y84.417 E.06707
G1 X73.275 Y84.417 E.01649
G1 X72.272 Y85.42 E.04375
G1 X72.272 Y84.885 E.01649
G1 X72.91 Y84.247 E.02782
M204 S10000
G1 X68.45 Y85.431 F42000
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X68.45 Y84.432 E.03313
G1 X69.08 Y84.432 E.02088
G1 X71.88 Y87.231 E.13134
G1 X71.88 Y85.093 E.07095
G1 X68.45 Y88.522 E.16087
G1 X68.45 Y91.478 E.09807
G1 X69.556 Y92.584 E.05187
G1 X70.329 Y91.151 E.05401
M204 S10000
G1 X111.55 Y94.569 F42000
G1 F15476.087
M204 S6000
G1 X111.55 Y95.568 E.03313
G1 X110.92 Y95.568 E.02088
G1 X110.582 Y95.23 E.01585
G1 X110.582 Y92.446 E.09238
G1 X111.55 Y91.478 E.04538
G1 X111.55 Y88.522 E.09807
G1 X110.582 Y87.555 E.04538
G1 X110.582 Y84.77 E.09238
G1 X110.92 Y84.432 E.01585
G1 X111.55 Y84.432 E.02088
G1 X111.55 Y85.431 E.03313
; CHANGE_LAYER
; Z_HEIGHT: 1.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15476.087
G1 X111.55 Y84.432 E-.37956
G1 X110.92 Y84.432 E-.23921
G1 X110.657 Y84.695 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 9/15
; update layer progress
M73 L9
M991 S0 P8 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z2 I-1.21 J.134 P1  F42000
G1 X111.898 Y95.917 Z2
G1 Z1.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F15476.087
M204 S6000
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X111.898 Y84.083 E1.45279
G1 X111.898 Y95.857 E.39053
M204 S250
G1 X112.29 Y96.309 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.2 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z2.2
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z2.2 F4000
            G39.3 S1
            G0 Z2.2 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X111.55 Y85.431 F42000
G1 Z1.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X111.55 Y84.432 E.03313
G1 X110.92 Y84.432 E.02088
G1 X110.582 Y84.77 E.01585
G1 X110.582 Y87.555 E.09238
G1 X111.55 Y88.522 E.04538
G1 X111.55 Y91.478 E.09807
G1 X110.582 Y92.446 E.04538
G1 X110.582 Y95.23 E.09238
G1 X110.92 Y95.568 E.01585
G1 X111.55 Y95.568 E.02088
G1 X111.55 Y94.569 E.03313
M204 S10000
G1 X110.36 Y85.056 F42000
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42216
G1 F15000
M204 S6000
G1 X109.72 Y84.417 E.02796
G1 X109.184 Y84.417 E.01657
G1 X110.19 Y85.423 E.04398
G1 X110.19 Y85.959 E.01657
G1 X108.647 Y84.417 E.06742
G1 X108.111 Y84.417 E.01657
G1 X110.19 Y86.496 E.09086
G1 X110.19 Y87.032 E.01657
G1 X107.575 Y84.417 E.1143
G1 X107.039 Y84.417 E.01657
G1 X110.19 Y87.568 E.13774
G1 X110.19 Y88.105 E.01657
G1 X106.502 Y84.417 E.16118
G1 X105.966 Y84.417 E.01657
G1 X110.19 Y88.641 E.18462
G1 X110.19 Y89.177 E.01657
G1 X105.43 Y84.417 E.20806
G1 X104.893 Y84.417 E.01657
G1 X110.19 Y89.714 E.2315
G1 X110.19 Y90.25 E.01657
G1 X104.357 Y84.417 E.25494
G1 X103.821 Y84.417 E.01657
G1 X110.19 Y90.786 E.27838
G1 X110.19 Y91.323 E.01657
G1 X103.284 Y84.417 E.30182
G1 X102.748 Y84.417 E.01657
G1 X110.19 Y91.859 E.32526
G1 X110.19 Y92.395 E.01657
G1 X102.212 Y84.417 E.3487
G1 X101.675 Y84.417 E.01657
G1 X110.19 Y92.932 E.37214
G1 X110.19 Y93.468 E.01657
G1 X101.139 Y84.417 E.39558
G1 X100.603 Y84.417 E.01657
G1 X110.19 Y94.004 E.41902
G1 X110.19 Y94.541 E.01657
G1 X100.066 Y84.417 E.44246
G1 X99.53 Y84.417 E.01657
G1 X110.19 Y95.077 E.4659
G1 X110.19 Y95.583 E.01565
G1 X110.16 Y95.583 E.00093
G1 X98.994 Y84.417 E.48802
G1 X98.457 Y84.417 E.01657
G1 X109.624 Y95.583 E.48802
G1 X109.088 Y95.583 E.01657
G1 X97.921 Y84.417 E.48802
G1 X97.385 Y84.417 E.01657
G1 X108.551 Y95.583 E.48802
G1 X108.015 Y95.583 E.01657
G1 X96.848 Y84.417 E.48802
G1 X96.312 Y84.417 E.01657
G1 X107.479 Y95.583 E.48802
G1 X106.942 Y95.583 E.01657
G1 X95.776 Y84.417 E.48802
G1 X95.239 Y84.417 E.01657
G1 X106.406 Y95.583 E.48802
G1 X105.87 Y95.583 E.01657
G1 X94.703 Y84.417 E.48802
G1 X94.167 Y84.417 E.01657
M73 P73 R3
G1 X105.333 Y95.583 E.48802
G1 X104.797 Y95.583 E.01657
G1 X93.63 Y84.417 E.48802
G1 X93.094 Y84.417 E.01657
G1 X104.261 Y95.583 E.48802
G1 X103.724 Y95.583 E.01657
G1 X92.558 Y84.417 E.48802
G1 X92.021 Y84.417 E.01657
G1 X103.188 Y95.583 E.48802
G1 X102.652 Y95.583 E.01657
G1 X91.485 Y84.417 E.48802
G1 X90.949 Y84.417 E.01657
G1 X102.115 Y95.583 E.48802
G1 X101.579 Y95.583 E.01657
G1 X90.412 Y84.417 E.48802
G1 X89.876 Y84.417 E.01657
G1 X101.043 Y95.583 E.48802
G1 X100.506 Y95.583 E.01657
G1 X89.34 Y84.417 E.48802
G1 X88.803 Y84.417 E.01657
G1 X99.97 Y95.583 E.48802
G1 X99.434 Y95.583 E.01657
G1 X88.267 Y84.417 E.48802
G1 X87.731 Y84.417 E.01657
G1 X98.897 Y95.583 E.48802
G1 X98.361 Y95.583 E.01657
G1 X87.194 Y84.417 E.48802
G1 X86.658 Y84.417 E.01657
G1 X97.825 Y95.583 E.48802
G1 X97.288 Y95.583 E.01657
G1 X86.122 Y84.417 E.48802
G1 X85.585 Y84.417 E.01657
G1 X96.752 Y95.583 E.48802
G1 X96.216 Y95.583 E.01657
G1 X85.049 Y84.417 E.48802
G1 X84.513 Y84.417 E.01657
G1 X95.679 Y95.583 E.48802
G1 X95.143 Y95.583 E.01657
M73 P73 R2
G1 X83.976 Y84.417 E.48802
G1 X83.44 Y84.417 E.01657
G1 X94.607 Y95.583 E.48802
G1 X94.07 Y95.583 E.01657
G1 X82.904 Y84.417 E.48802
G1 X82.367 Y84.417 E.01657
G1 X93.534 Y95.583 E.48802
G1 X92.998 Y95.583 E.01657
G1 X81.831 Y84.417 E.48802
G1 X81.295 Y84.417 E.01657
G1 X92.461 Y95.583 E.48802
G1 X91.925 Y95.583 E.01657
G1 X80.759 Y84.417 E.48802
G1 X80.222 Y84.417 E.01657
G1 X91.389 Y95.583 E.48802
G1 X90.852 Y95.583 E.01657
G1 X79.686 Y84.417 E.48802
G1 X79.15 Y84.417 E.01657
G1 X90.316 Y95.583 E.48802
G1 X89.78 Y95.583 E.01657
G1 X78.613 Y84.417 E.48802
G1 X78.077 Y84.417 E.01657
G1 X89.243 Y95.583 E.48802
G1 X88.707 Y95.583 E.01657
G1 X77.541 Y84.417 E.48802
G1 X77.004 Y84.417 E.01657
G1 X88.171 Y95.583 E.48802
G1 X87.634 Y95.583 E.01657
G1 X76.468 Y84.417 E.48802
G1 X75.932 Y84.417 E.01657
G1 X87.098 Y95.583 E.48802
G1 X86.562 Y95.583 E.01657
G1 X75.395 Y84.417 E.48802
G1 X74.859 Y84.417 E.01657
G1 X86.025 Y95.583 E.48802
G1 X85.489 Y95.583 E.01657
G1 X74.323 Y84.417 E.48802
G1 X73.786 Y84.417 E.01657
G1 X84.953 Y95.583 E.48802
G1 X84.416 Y95.583 E.01657
G1 X73.25 Y84.417 E.48802
G1 X72.714 Y84.417 E.01657
G1 X83.88 Y95.583 E.48802
G1 X83.344 Y95.583 E.01657
G1 X72.272 Y84.511 E.48389
G1 X72.272 Y85.047 E.01657
G1 X82.808 Y95.583 E.46045
G1 X82.271 Y95.583 E.01657
G1 X72.272 Y85.584 E.43702
G1 X72.272 Y86.12 E.01657
G1 X81.735 Y95.583 E.41358
G1 X81.199 Y95.583 E.01657
G1 X72.272 Y86.656 E.39014
G1 X72.272 Y87.193 E.01657
G1 X80.662 Y95.583 E.3667
G1 X80.126 Y95.583 E.01657
G1 X72.272 Y87.729 E.34326
G1 X72.272 Y88.265 E.01657
G1 X79.59 Y95.583 E.31982
G1 X79.053 Y95.583 E.01657
G1 X72.122 Y88.652 E.30292
G1 X71.934 Y89.001 E.01223
G1 X78.517 Y95.583 E.28769
G1 X77.981 Y95.583 E.01657
G1 X71.746 Y89.349 E.27246
G1 X71.558 Y89.697 E.01223
G1 X77.444 Y95.583 E.25723
G1 X76.908 Y95.583 E.01657
G1 X71.37 Y90.046 E.24201
G1 X71.183 Y90.394 E.01223
G1 X76.372 Y95.583 E.22678
G1 X75.835 Y95.583 E.01657
G1 X70.995 Y90.743 E.21155
G1 X70.807 Y91.091 E.01223
G1 X75.299 Y95.583 E.19633
G1 X74.763 Y95.583 E.01657
G1 X70.619 Y91.439 E.1811
G1 X70.431 Y91.788 E.01223
G1 X74.226 Y95.583 E.16587
G1 X73.69 Y95.583 E.01657
G1 X70.243 Y92.136 E.15065
M73 P74 R2
G1 X70.055 Y92.485 E.01223
G1 X73.154 Y95.583 E.13542
G1 X72.617 Y95.583 E.01657
G1 X69.867 Y92.833 E.12019
G1 X69.679 Y93.182 E.01223
G1 X72.081 Y95.583 E.10496
G1 X71.545 Y95.583 E.01657
G1 X69.491 Y93.53 E.08974
G1 X69.303 Y93.878 E.01223
G1 X71.008 Y95.583 E.07451
G1 X70.472 Y95.583 E.01657
G1 X69.116 Y94.227 E.05928
G1 X68.928 Y94.575 E.01223
G1 X69.936 Y95.583 E.04406
G1 X69.399 Y95.583 E.01657
G1 X68.74 Y94.924 E.02883
G1 X68.552 Y95.272 E.01223
G1 X69.033 Y95.753 E.02102
M204 S10000
G1 X70.329 Y91.151 F42000
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X69.556 Y92.584 E.05401
G1 X68.45 Y91.478 E.05187
G1 X68.45 Y88.522 E.09807
G1 X71.88 Y85.093 E.16087
G1 X71.88 Y87.231 E.07095
G1 X69.08 Y84.432 E.13134
G1 X68.45 Y84.432 E.02088
G1 X68.45 Y85.431 E.03313
; CHANGE_LAYER
; Z_HEIGHT: 2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15476.087
G1 X68.45 Y84.432 E-.37956
G1 X69.08 Y84.432 E-.23921
G1 X69.343 Y84.695 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 10/15
; update layer progress
M73 L10
M991 S0 P9 ;notify layer change
M106 S198.9
; OBJECT_ID: 110
M204 S10000
G17
G3 Z2.2 I-.472 J1.122 P1  F42000
G1 X87.449 Y92.312 Z2.2
G1 Z2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F15476.087
M204 S6000
G3 X87.344 Y92.56 I-.905 J-.237 E.00894
G3 X86.823 Y92.758 I-.629 J-.87 E.01872
G3 X85.594 Y92.818 I-.992 J-7.745 E.04086
G1 X85.594 Y91.088 E.05738
G3 X86.544 Y91.108 I.259 J10.465 E.03155
G3 X87.302 Y91.358 I-.023 J1.342 E.02687
G3 X87.476 Y91.994 I-.726 J.541 E.02239
G3 X87.462 Y92.254 I-.932 J.082 E.00869
; WIPE_START
G1 X87.407 Y92.457 E-.07999
G1 X87.344 Y92.56 E-.04567
G1 X87.276 Y92.612 E-.03242
G1 X87.138 Y92.676 E-.05779
G1 X86.823 Y92.758 E-.12399
G1 X86.458 Y92.803 E-.13966
G1 X85.72 Y92.816 E-.28047
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.844 Y85.485 Z2.4 F42000
G1 X88.25 Y84.083 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X86.018 Y87.918 E.14719
G1 X85.594 Y87.918 E.01407
G1 X85.594 Y84.083 E.12721
G1 X88.19 Y84.083 E.08613
; WIPE_START
G1 X87.204 Y85.824 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X91.452 Y92.165 Z2.4 F42000
G1 X93.965 Y95.917 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X88.33 Y95.917 E.18695
G1 X88.296 Y95.712 E.00688
G2 X90.832 Y92.574 I-.967 J-3.376 E.14256
G2 X90.403 Y90.15 I-4.25 J-.498 E.08284
G2 X89.257 Y88.901 I-3.217 J1.801 E.05676
G1 X90.436 Y86.95 E.07561
G1 X92.859 Y93.107 E.2195
G1 X93.943 Y95.861 E.09816
; WIPE_START
G1 X91.943 Y95.881 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.416 Y89.084 Z2.4 F42000
G1 X96.519 Y86.924 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X93.921 Y86.924 E.08618
G1 X92.822 Y84.083 E.10104
G1 X97.632 Y84.083 E.15953
G1 X96.541 Y86.868 E.09921
; WIPE_START
G1 X94.541 Y86.911 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X98.53 Y93.418 Z2.4 F42000
G1 X100.062 Y95.917 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X96.535 Y95.917 E.117
G1 X99.863 Y87.42 E.30271
G1 X100.062 Y87.457 E.00671
G1 X100.062 Y95.857 E.27862
; WIPE_START
G1 X98.062 Y95.891 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X102.917 Y90.001 Z2.4 F42000
G1 X103.484 Y89.314 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X103.31 Y89.262 E.00605
G1 X103.31 Y84.083 E.17178
G1 X106.891 Y84.083 E.11879
G1 X103.517 Y89.264 E.20507
; WIPE_START
G1 X103.31 Y89.262 E-.07883
G1 X103.31 Y87.469 E-.68117
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X106.291 Y94.496 Z2.4 F42000
G1 X106.894 Y95.917 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X103.119 Y95.917 E.12522
G1 X106.721 Y90.394 E.21872
G1 X106.896 Y90.446 E.00604
G1 X106.894 Y95.857 E.17948
; WIPE_START
G1 X104.894 Y95.888 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X111.898 Y95.917 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X110.155 Y95.917 E.05782
G1 X110.155 Y84.083 E.39252
G1 X111.898 Y84.083 E.05782
G1 X111.898 Y95.857 E.39053
; WIPE_START
G1 X110.155 Y95.917 E-.66277
G1 X110.155 Y95.661 E-.09723
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X102.523 Y95.731 Z2.4 F42000
G1 X82.257 Y95.917 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X81.626 Y95.917 E.02093
G1 X81.626 Y84.083 E.39252
G1 X82.257 Y84.083 E.02093
G1 X82.257 Y95.857 E.39053
; WIPE_START
G1 X81.626 Y95.917 E-.24089
G1 X81.626 Y94.55 E-.51911
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.29 Y92.881 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X78.106 Y92.928 E.0063
G1 X75.657 Y88.437 E.16969
G1 X75.657 Y84.083 E.14441
G1 X78.29 Y84.083 E.08733
G1 X78.29 Y92.821 E.28984
; WIPE_START
G1 X78.106 Y92.928 E-.08083
G1 X77.25 Y91.359 E-.67918
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X75.995 Y95.917 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X71.99 Y95.917 E.13286
G1 X73.986 Y92.147 E.14148
G1 X75.967 Y95.864 E.1397
; WIPE_START
G1 X73.967 Y95.89 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X72.319 Y88.438 Z2.4 F42000
G1 X72.307 Y88.384 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X68.287 Y95.838 E.28096
G1 X68.102 Y95.792 E.00631
G1 X68.102 Y84.083 E.38839
G1 X72.307 Y84.083 E.13949
G1 X72.307 Y88.324 E.14066
; WIPE_START
G1 X71.364 Y90.087 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.909 Y91.234 Z2.4 F42000
G1 X112.29 Y96.309 Z2.4
G1 Z2
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.4 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z2.4
G1 X0 Y90 F18000 ; move to safe pos
M73 P75 R2
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z2.4 F4000
            G39.3 S1
            G0 Z2.4 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X109.959 Y95.963 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.34189
G1 F15000
M204 S6000
G1 X107.09 Y95.963 E.06989
M204 S10000
G1 X109.543 Y95.787 F42000
; FEATURE: Top surface
; LINE_WIDTH: 0.42
G1 F12000
M204 S2000
G1 X109.884 Y95.446 E.01484
G1 X109.884 Y94.912
G1 X109.009 Y95.787 E.03802
G1 X108.476 Y95.787
G1 X109.884 Y94.379 E.06119
G1 X109.884 Y93.846
G1 X107.943 Y95.787 E.08436
G1 X107.41 Y95.787
G1 X109.884 Y93.313 E.10753
G1 X109.884 Y92.779
G1 X107.165 Y95.499 E.11818
G1 X107.165 Y94.965
G1 X109.884 Y92.246 E.11817
G1 X109.884 Y91.713
G1 X107.165 Y94.432 E.11816
G1 X107.165 Y93.899
G1 X109.884 Y91.18 E.11815
G1 X109.884 Y90.646
G1 X107.165 Y93.365 E.11815
G1 X107.165 Y92.832
G1 X109.884 Y90.113 E.11814
G1 X109.884 Y89.58
G1 X107.166 Y92.298 E.11813
G1 X107.166 Y91.765
G1 X109.884 Y89.046 E.11812
G1 X109.884 Y88.513
G1 X107.166 Y91.231 E.11811
G1 X107.166 Y90.698
G1 X109.884 Y87.98 E.11811
G1 X109.884 Y87.447
G1 X107.166 Y90.164 E.1181
G1 X107.129 Y89.668
G1 X109.884 Y86.913 E.11971
; WIPE_START
M204 S6000
G1 X108.47 Y88.328 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X103.849 Y94.402 Z2.4 F42000
G1 X103.386 Y95.012 Z2.4
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X102.61 Y95.787 E.0337
G1 X102.077 Y95.787
G1 X104.386 Y93.478 E.10033
M204 S10000
G1 X105.386 Y91.945 F42000
G1 F12000
M204 S2000
G1 X101.544 Y95.787 E.16697
G1 X101.01 Y95.787
G1 X106.386 Y90.411 E.23361
; WIPE_START
M204 S6000
G1 X104.972 Y91.825 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X100.477 Y95.787 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X109.884 Y86.38 E.40878
G1 X109.884 Y85.847
G1 X100.333 Y95.398 E.41505
G1 X100.333 Y94.865
G1 X102.114 Y93.084 E.0774
; WIPE_START
M204 S6000
G1 X100.7 Y94.498 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X105.904 Y88.915 Z2.4 F42000
G1 X108.016 Y86.648 Z2.4
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X100.333 Y94.332 E.33389
; WIPE_START
M204 S6000
G1 X101.747 Y92.918 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.636 Y95.829 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X96.692 Y94.773 E.04592
G1 X97.036 Y93.896
G1 X95.102 Y95.829 E.08401
G1 X94.569 Y95.829
G1 X97.379 Y93.019 E.12211
G1 X97.722 Y92.143
G1 X94.169 Y95.696 E.15439
G1 X94.019 Y95.313
G1 X98.066 Y91.266 E.17586
G1 X98.409 Y90.39
G1 X93.868 Y94.931 E.19732
G1 X93.718 Y94.548
G1 X98.752 Y89.513 E.21879
G1 X99.096 Y88.636
G1 X93.567 Y94.165 E.24025
G1 X93.416 Y93.783
G1 X99.439 Y87.76 E.26172
G1 X99.868 Y86.798
G1 X93.266 Y93.4 E.2869
G1 X93.115 Y93.017
G1 X95.217 Y90.915 E.09134
G1 X95.07 Y90.529
G1 X92.964 Y92.635 E.09151
G1 X92.814 Y92.252
G1 X94.924 Y90.142 E.09169
G1 X95.316 Y90.816
G1 X100.211 Y85.921 E.21272
; WIPE_START
M204 S6000
G1 X98.797 Y87.335 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X102.13 Y93.068 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X109.884 Y85.314 E.33695
G1 X109.884 Y84.78
G1 X108.081 Y86.583 E.07834
; WIPE_START
M204 S6000
G1 X109.495 Y85.169 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X109.932 Y84.199 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X100.333 Y93.799 E.41715
G1 X100.333 Y93.265
G1 X109.683 Y83.915 E.4063
G1 X109.149 Y83.915
G1 X103.913 Y89.152 E.22756
M204 S10000
G1 X104.909 Y87.623 F42000
G1 F12000
M204 S2000
G1 X108.616 Y83.915 E.16111
G1 X108.083 Y83.915
G1 X105.905 Y86.094 E.09466
M204 S10000
G1 X106.901 Y84.564 F42000
G1 F12000
M204 S2000
G1 X107.55 Y83.915 E.02821
M204 S10000
M73 P76 R2
G1 X103.033 Y90.032 F42000
G1 F12000
M204 S2000
G1 X100.333 Y92.732 E.11733
G1 X100.333 Y92.199
G1 X103.033 Y89.498 E.11736
G1 X103.034 Y88.964
G1 X100.333 Y91.665 E.11738
G1 X100.333 Y91.132
G1 X103.034 Y88.431 E.1174
G1 X103.035 Y87.897
G1 X100.333 Y90.599 E.11743
G1 X100.333 Y90.066
G1 X103.036 Y87.363 E.11745
G1 X103.036 Y86.829
G1 X100.333 Y89.532 E.11747
G1 X100.333 Y88.999
G1 X103.037 Y86.295 E.11749
G1 X103.037 Y85.762
G1 X100.333 Y88.466 E.11752
G1 X100.333 Y87.933
G1 X103.038 Y85.228 E.11754
G1 X103.038 Y84.694
G1 X100.333 Y87.399 E.11756
G1 X100.284 Y86.914
G1 X103.087 Y84.112 E.12178
G1 X102.75 Y83.915
G1 X100.284 Y86.381 E.10715
G1 X100.284 Y85.848
G1 X102.217 Y83.915 E.08398
G1 X101.684 Y83.915
G1 X95.637 Y89.962 E.26277
G1 X95.146 Y89.92
G1 X101.151 Y83.915 E.26095
G1 X100.617 Y83.915
G1 X92.663 Y91.869 E.34565
G1 X92.513 Y91.487
G1 X100.084 Y83.915 E.32902
G1 X99.551 Y83.915
G1 X96.982 Y86.484 E.11161
G1 X97.326 Y85.607
G1 X99.018 Y83.915 E.07352
G1 X98.484 Y83.915
G1 X97.669 Y84.731 E.03543
; WIPE_START
M204 S6000
G1 X98.484 Y83.915 E-.43818
G1 X99.018 Y83.915 E-.20264
G1 X98.796 Y84.137 E-.11918
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X96.271 Y87.195 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X92.362 Y91.104 E.16987
G1 X92.211 Y90.722
G1 X95.738 Y87.195 E.15325
G1 X95.205 Y87.195
G1 X92.061 Y90.339 E.13662
G1 X91.91 Y89.956
G1 X94.671 Y87.195 E.11999
G1 X94.138 Y87.195
G1 X91.759 Y89.574 E.10336
G1 X91.609 Y89.191
G1 X93.699 Y87.101 E.09084
G1 X93.551 Y86.716
G1 X91.458 Y88.808 E.09092
G1 X91.308 Y88.426
G1 X93.402 Y86.331 E.09101
G1 X93.253 Y85.947
G1 X91.157 Y88.043 E.09109
G1 X91.006 Y87.66
G1 X93.105 Y85.562 E.09118
G1 X92.956 Y85.178
G1 X90.856 Y87.278 E.09126
G1 X90.705 Y86.895
G1 X92.807 Y84.793 E.09135
G1 X92.658 Y84.409
G1 X90.517 Y86.55 E.09305
; WIPE_START
M204 S6000
G1 X91.931 Y85.136 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.461 Y92.625 Z2.4 F42000
G1 X90.238 Y93.762 Z2.4
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X88.666 Y95.334 E.06831
G1 X87.867 Y95.599
G1 X90.499 Y92.967 E.11437
G1 X90.571 Y92.362
G1 X87.218 Y95.715 E.14573
G1 X86.633 Y95.767
G1 X90.574 Y91.825 E.17128
G1 X90.523 Y91.343
G1 X86.079 Y95.787 E.19312
G1 X85.546 Y95.787
G1 X90.425 Y90.908 E.21203
G1 X90.279 Y90.52
G1 X85.013 Y95.787 E.22886
G1 X84.479 Y95.787
G1 X90.097 Y90.169 E.24412
G1 X89.881 Y89.852
G1 X87.696 Y92.037 E.09493
G1 X87.647 Y91.553
G1 X89.633 Y89.567 E.0863
G1 X89.355 Y89.312
G1 X87.463 Y91.204 E.08223
G1 X87.129 Y91.004
G1 X89.048 Y89.085 E.08341
G1 X89.308 Y88.292
G1 X86.696 Y90.905 E.11351
G1 X86.198 Y90.869
G1 X90.123 Y86.944 E.17056
; WIPE_START
M204 S6000
G1 X88.709 Y88.358 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X92.547 Y83.987 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X85.668 Y90.866 E.2989
; WIPE_START
M204 S6000
G1 X87.082 Y89.451 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X86.741 Y92.992 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X83.946 Y95.787 E.12146
G1 X83.413 Y95.787
G1 X86.164 Y93.036 E.11956
G1 X85.627 Y93.04
G1 X82.88 Y95.787 E.11937
G1 X82.528 Y95.606
G1 X85.371 Y92.763 E.12355
G1 X85.371 Y92.229
G1 X82.528 Y95.072 E.12355
G1 X82.528 Y94.539
G1 X85.371 Y91.696 E.12355
G1 X85.371 Y91.163
G1 X82.528 Y94.006 E.12355
G1 X82.528 Y93.473
G1 X92.085 Y83.915 E.41531
M73 P77 R2
G1 X91.552 Y83.915
G1 X82.528 Y92.939 E.39214
G1 X82.528 Y92.406
G1 X91.019 Y83.915 E.36897
G1 X90.485 Y83.915
G1 X82.528 Y91.873 E.3458
G1 X82.528 Y91.34
G1 X85.678 Y88.189 E.13691
G1 X85.323 Y88.011
G1 X82.528 Y90.806 E.12145
G1 X82.528 Y90.273
G1 X85.323 Y87.478 E.12145
G1 X85.323 Y86.945
G1 X82.528 Y89.74 E.12145
G1 X82.528 Y89.207
G1 X85.323 Y86.412 E.12145
G1 X85.323 Y85.878
G1 X82.528 Y88.673 E.12145
G1 X82.528 Y88.14
G1 X85.323 Y85.345 E.12145
G1 X85.323 Y84.812
G1 X82.528 Y87.607 E.12145
G1 X82.528 Y87.074
G1 X85.371 Y84.23 E.12355
G1 X85.153 Y83.915
G1 X82.528 Y86.54 E.11407
G1 X82.528 Y86.007
G1 X84.62 Y83.915 E.0909
G1 X84.086 Y83.915
G1 X82.528 Y85.474 E.06772
G1 X82.528 Y84.941
G1 X83.553 Y83.915 E.04455
G1 X83.02 Y83.915
G1 X82.528 Y84.407 E.02138
; WIPE_START
M204 S6000
G1 X83.02 Y83.915 E-.2644
G1 X83.553 Y83.915 E-.20264
G1 X83.008 Y84.461 E-.29296
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X86.862 Y87.006 Z2.4 F42000
G1 Z2
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X89.952 Y83.915 E.1343
G1 X89.419 Y83.915
G1 X87.605 Y85.729 E.07882
M204 S10000
G1 X88.348 Y84.453 F42000
G1 F12000
M204 S2000
G1 X88.886 Y83.915 E.02334
; WIPE_START
M204 S6000
G1 X88.348 Y84.453 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.426 Y89.069 Z2.4 F42000
G1 X95.748 Y90.073 Z2.4
G1 Z2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.127978
G1 F15000
M204 S6000
G3 X95.517 Y90.227 I-.306 J-.207 E.00197
; WIPE_START
G1 X95.617 Y90.191 E-.2873
G1 X95.748 Y90.073 E-.4727
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X88.158 Y90.88 Z2.4 F42000
G1 X87.093 Y90.993 Z2.4
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.10208
G1 F15000
M204 S6000
G2 X86.956 Y90.911 I-1.59 J2.48 E.00077
M204 S10000
G1 X86.215 Y90.887 F42000
; LINE_WIDTH: 0.121866
G1 F15000
M204 S6000
G1 X86.004 Y90.796 E.00148
; WIPE_START
G1 X86.215 Y90.887 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.408 Y93.367 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.203958
G1 F15000
M204 S6000
G1 X90.176 Y93.7 E.00532
; WIPE_START
G1 X90.408 Y93.367 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X89.669 Y87.693 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.11106
G1 F15000
M204 S6000
G1 X89.528 Y87.872 E.00127
; LINE_WIDTH: 0.156845
G1 X89.388 Y88.052 E.00212
; LINE_WIDTH: 0.202631
G1 X89.247 Y88.232 E.00297
M204 S10000
G1 X90.447 Y86.538 F42000
; LINE_WIDTH: 0.164815
G1 F15000
M204 S6000
G1 X90.384 Y86.509 E.00069
G2 X90.325 Y86.547 I.041 J.127 E.00071
; LINE_WIDTH: 0.165032
G1 X90.194 Y86.715 E.00212
; LINE_WIDTH: 0.205369
G1 X90.062 Y86.883 E.00282
; WIPE_START
G1 X90.194 Y86.715 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X96.857 Y90.438 Z2.4 F42000
G1 X103.827 Y94.333 Z2.4
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.111639
G1 F15000
M204 S6000
G1 X103.659 Y94.539 E.00149
; LINE_WIDTH: 0.158579
G1 X103.492 Y94.745 E.0025
; LINE_WIDTH: 0.20552
G1 X103.325 Y94.951 E.00352
M204 S10000
G1 X104.827 Y92.799 F42000
; LINE_WIDTH: 0.111638
G1 F15000
M204 S6000
G1 X104.66 Y93.005 E.00149
; LINE_WIDTH: 0.158578
G1 X104.492 Y93.211 E.0025
; LINE_WIDTH: 0.205518
G1 X104.325 Y93.418 E.00352
M204 S10000
G1 X105.827 Y91.266 F42000
; LINE_WIDTH: 0.111638
G1 F15000
M204 S6000
G1 X105.66 Y91.472 E.00149
; LINE_WIDTH: 0.158578
G1 X105.493 Y91.678 E.0025
; LINE_WIDTH: 0.205518
G1 X105.326 Y91.884 E.00352
M204 S10000
G1 X106.827 Y89.732 F42000
; LINE_WIDTH: 0.111638
G1 F15000
M204 S6000
G1 X106.66 Y89.938 E.00149
; LINE_WIDTH: 0.158578
G1 X106.493 Y90.144 E.0025
; LINE_WIDTH: 0.205518
G1 X106.326 Y90.351 E.00352
; WIPE_START
G1 X106.493 Y90.144 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X106.961 Y84.625 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.20547
G1 F15000
M204 S6000
G1 X106.795 Y84.831 E.0035
; LINE_WIDTH: 0.15855
G1 X106.628 Y85.036 E.00249
; LINE_WIDTH: 0.111629
G1 X106.461 Y85.241 E.00148
M204 S10000
G1 X105.965 Y86.154 F42000
; LINE_WIDTH: 0.205458
G1 F15000
M204 S6000
G1 X105.799 Y86.36 E.0035
; LINE_WIDTH: 0.158542
G1 X105.632 Y86.565 E.00249
; LINE_WIDTH: 0.111627
G1 X105.465 Y86.771 E.00148
M204 S10000
G1 X104.969 Y87.683 F42000
; LINE_WIDTH: 0.205458
G1 F15000
M204 S6000
G1 X104.803 Y87.889 E.0035
; LINE_WIDTH: 0.158542
G1 X104.636 Y88.094 E.00249
; LINE_WIDTH: 0.111627
G1 X104.469 Y88.3 E.00148
M204 S10000
G1 X103.973 Y89.213 F42000
; LINE_WIDTH: 0.205458
G1 F15000
M204 S6000
G1 X103.807 Y89.418 E.0035
; LINE_WIDTH: 0.158543
G1 X103.64 Y89.624 E.00249
; LINE_WIDTH: 0.111627
G1 X103.474 Y89.829 E.00148
; WIPE_START
G1 X103.64 Y89.624 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X103.02 Y84.446 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.117644
G1 F15000
M204 S6000
G1 X103.02 Y84.676 E.0014
; WIPE_START
G1 X103.02 Y84.446 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.387 Y84.481 Z2.4 F42000
G1 X88.409 Y84.513 Z2.4
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.201238
G1 F15000
M204 S6000
G1 X88.279 Y84.683 E.00276
; LINE_WIDTH: 0.156009
G1 X88.149 Y84.852 E.00197
; LINE_WIDTH: 0.11078
G1 X88.018 Y85.021 E.00118
M204 S10000
G1 X87.666 Y85.79 F42000
; LINE_WIDTH: 0.20125
G1 F15000
M204 S6000
G1 X87.536 Y85.959 E.00276
; LINE_WIDTH: 0.156016
G1 X87.405 Y86.129 E.00197
; LINE_WIDTH: 0.110783
G1 X87.275 Y86.298 E.00118
M204 S10000
G1 X86.923 Y87.067 F42000
; LINE_WIDTH: 0.20124
G1 F15000
M204 S6000
G1 X86.792 Y87.236 E.00276
; LINE_WIDTH: 0.15601
G1 X86.662 Y87.405 E.00197
; LINE_WIDTH: 0.11078
G1 X86.531 Y87.575 E.00118
; WIPE_START
G1 X86.662 Y87.405 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.729 Y94.963 Z2.4 F42000
G1 X87.811 Y95.543 Z2.4
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.0884455
G1 F15000
M204 S6000
G1 X87.547 Y95.675 E.0011
M204 S10000
G1 X87.601 Y95.903 F42000
; LINE_WIDTH: 0.440977
G1 F15000
M204 S6000
G1 X87.272 Y95.924 E.0107
; LINE_WIDTH: 0.396386
G3 X86.927 Y95.947 I-.671 J-7.635 E.00994
; LINE_WIDTH: 0.344738
G1 X86.146 Y95.963 E.01923
G3 X82.453 Y95.963 I-1.849 J-189.852 E.09081
M204 S10000
G1 X81.942 Y95.713 F42000
; LINE_WIDTH: 0.26693
G1 F15000
M204 S6000
G1 X81.942 Y84.287 E.20857
; WIPE_START
G1 X81.942 Y86.287 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X85.986 Y87.194 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.568 Y84.476 E.09666
G1 X85.986 Y84.476 E.04863
G1 X85.986 Y87.134 E.08169
M204 S10000
G1 X86.369 Y85.774 F42000
; LINE_WIDTH: 0.43213
G1 F15000
M204 S6000
G1 X86.902 Y84.859 E.03361
G1 X86.369 Y84.859 E.01691
G1 X86.369 Y85.714 E.02714
; WIPE_START
G1 X86.369 Y84.859 E-.32519
G1 X86.902 Y84.859 E-.20257
G1 X86.594 Y85.387 E-.23224
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.312 Y88.674 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.45602
G1 F15000
M204 S6000
G2 X90.304 Y88.764 I-.026 J.043 E.00679
M204 S10000
G1 X90.54 Y89.587 F42000
; LINE_WIDTH: 0.425951
G1 F15000
M204 S6000
G1 X90.922 Y90.318 E.02574
G1 X91.176 Y91.097 E.02556
G1 X91.248 Y92.043 E.02963
G1 X91.159 Y93.05 E.03155
G1 X90.931 Y93.838 E.0256
G1 X90.579 Y94.514 E.02377
G1 X90.095 Y95.105 E.02384
G1 X89.759 Y95.384 E.01364
G1 X89.821 Y95.471 E.00337
G1 X89.812 Y95.524 E.00168
G1 X93.39 Y95.524 E.11167
G1 X91.953 Y91.875 E.12241
G3 X91.301 Y90.229 I25.351 J-11 E.05527
; LINE_WIDTH: 0.450334
G3 X90.677 Y88.632 I12.755 J-5.906 E.05697
; LINE_WIDTH: 0.425022
G1 X90.361 Y87.831 E.02681
G1 X89.774 Y88.803 E.03537
G1 X90.029 Y89.021 E.01045
G1 X90.5 Y89.543 E.0219
M204 S10000
G1 X91.624 Y92.067 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X91.534 Y93.085 E.03138
G1 X91.292 Y93.945 E.02744
G1 X90.913 Y94.689 E.02569
G1 X90.549 Y95.147 E.01797
G1 X92.836 Y95.147 E.07027
G1 X91.646 Y92.123 E.09986
M204 S10000
M73 P78 R2
G1 X91.81 Y93.745 F42000
; LINE_WIDTH: 0.54698
G1 F12498.513
M204 S6000
G3 X91.401 Y94.707 I-3.151 J-.772 E.04312
G1 X92.189 Y94.707 E.03236
G1 X91.832 Y93.801 E.04
M204 S10000
G1 X89.348 Y95.484 F42000
; FEATURE: Gap infill
; LINE_WIDTH: 0.11084
G1 F15000
M204 S6000
G1 X89.227 Y95.571 E.00083
; LINE_WIDTH: 0.134974
G3 X88.961 Y95.694 I-.311 J-.324 E.00224
M204 S10000
G1 X88.119 Y95.844 F42000
; LINE_WIDTH: 0.510761
G1 F13466.115
M204 S6000
G1 X87.87 Y95.872 E.00956
; LINE_WIDTH: 0.479963
G1 F14415.063
G3 X87.601 Y95.903 I-.779 J-5.703 E.00965
; WIPE_START
G1 X87.87 Y95.872 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.026 Y91.658 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X86.88 Y91.58 E.00508
G2 X85.986 Y91.488 I-.719 J2.593 E.02777
G1 X85.986 Y92.419 E.02859
G2 X86.927 Y92.326 I.125 J-3.548 E.02915
G1 X87.06 Y92.241 E.00483
G1 X87.063 Y91.808 E.01332
G1 X87.04 Y91.717 E.00288
; WIPE_START
G1 X87.063 Y91.808 E-.03568
G1 X87.06 Y92.241 E-.16467
G1 X86.927 Y92.326 E-.05979
G1 X86.508 Y92.399 E-.1616
G1 X85.986 Y92.419 E-.19865
G1 X85.986 Y92.051 E-.13961
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X81.355 Y95.179 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Top surface
; LINE_WIDTH: 0.42
G1 F12000
M204 S2000
G1 X80.747 Y95.787 E.02645
G1 X80.213 Y95.787
G1 X81.355 Y94.645 E.04962
G1 X81.355 Y94.112
G1 X79.68 Y95.787 E.07279
G1 X79.147 Y95.787
G1 X81.355 Y93.579 E.09596
G1 X81.355 Y93.046
G1 X78.614 Y95.787 E.11914
G1 X78.08 Y95.787
G1 X81.355 Y92.512 E.14231
G1 X81.355 Y91.979
G1 X77.547 Y95.787 E.16548
G1 X77.014 Y95.787
G1 X81.355 Y91.446 E.18865
G1 X81.355 Y90.912
G1 X78.56 Y93.707 E.12145
G1 X78.56 Y93.174
G1 X81.355 Y90.379 E.12145
G1 X81.355 Y89.846
G1 X78.56 Y92.641 E.12145
G1 X78.56 Y92.108
G1 X81.355 Y89.313 E.12145
G1 X81.355 Y88.779
G1 X78.56 Y91.574 E.12145
G1 X78.56 Y91.041
G1 X81.355 Y88.246 E.12145
G1 X81.355 Y87.713
G1 X78.56 Y90.508 E.12145
G1 X78.56 Y89.975
G1 X81.355 Y87.18 E.12145
G1 X81.355 Y86.646
G1 X78.56 Y89.441 E.12145
G1 X78.56 Y88.908
G1 X81.355 Y86.113 E.12145
G1 X81.355 Y85.58
G1 X78.56 Y88.375 E.12145
G1 X78.56 Y87.842
G1 X81.355 Y85.047 E.12145
G1 X81.355 Y84.513
G1 X78.56 Y87.308 E.12145
G1 X78.56 Y86.775
G1 X81.403 Y83.932 E.12355
G1 X80.887 Y83.915
G1 X78.56 Y86.242 E.1011
G1 X78.56 Y85.709
G1 X80.353 Y83.915 E.07792
G1 X79.82 Y83.915
G1 X78.56 Y85.175 E.05475
G1 X78.56 Y84.642
G1 X79.287 Y83.915 E.03158
M204 S10000
G1 X78.377 Y93.891 F42000
G1 F12000
M204 S2000
G1 X76.481 Y95.787 E.08241
G1 X76.134 Y95.601
G1 X78.153 Y93.581 E.08776
G1 X77.965 Y93.236
G1 X75.948 Y95.253 E.08764
G1 X75.763 Y94.905
G1 X77.777 Y92.891 E.08752
G1 X77.589 Y92.546
G1 X75.578 Y94.557 E.0874
G1 X75.392 Y94.209
G1 X77.401 Y92.201 E.08728
G1 X77.213 Y91.856
G1 X75.207 Y93.861 E.08716
G1 X75.021 Y93.514
G1 X77.024 Y91.51 E.08704
G1 X76.836 Y91.165
G1 X74.836 Y93.166 E.08692
G1 X74.651 Y92.818
G1 X76.648 Y90.82 E.0868
G1 X76.46 Y90.475
G1 X74.465 Y92.47 E.08669
G1 X74.28 Y92.122
G1 X76.272 Y90.13 E.08657
G1 X76.084 Y89.785
G1 X74.094 Y91.774 E.08645
M204 S10000
G1 X72.433 Y94.502 F42000
G1 F12000
M204 S2000
G1 X71.148 Y95.787 E.05583
G1 X70.615 Y95.787
G1 X73.033 Y93.369 E.10508
M204 S10000
G1 X73.633 Y92.235 F42000
G1 F12000
M204 S2000
G1 X70.081 Y95.787 E.15434
G1 X69.548 Y95.787
G1 X75.895 Y89.44 E.27582
G1 X75.707 Y89.095
G1 X69.015 Y95.787 E.29082
G1 X68.981 Y95.288
G1 X75.519 Y88.75 E.28411
G1 X75.386 Y88.349
G1 X69.605 Y94.13 E.2512
M204 S10000
G1 X70.23 Y92.973 F42000
G1 F12000
M204 S2000
G1 X75.386 Y87.816 E.22407
G1 X75.386 Y87.283
G1 X70.854 Y91.815 E.19694
M204 S10000
G1 X71.478 Y90.657 F42000
G1 F12000
M204 S2000
G1 X75.386 Y86.75 E.16981
G1 X75.386 Y86.216
G1 X72.103 Y89.5 E.14268
G1 X72.657 Y88.412
G1 X75.386 Y85.683 E.11859
G1 X75.386 Y85.15
G1 X72.657 Y87.879 E.11859
G1 X72.657 Y87.346
G1 X75.386 Y84.617 E.11859
G1 X75.434 Y84.035
G1 X72.657 Y86.813 E.12069
G1 X72.657 Y86.279
G1 X75.021 Y83.915 E.10272
G1 X74.488 Y83.915
G1 X72.657 Y85.746 E.07955
G1 X72.657 Y85.213
G1 X73.954 Y83.915 E.05638
G1 X73.421 Y83.915
G1 X72.657 Y84.679 E.03321
; WIPE_START
M204 S6000
G1 X73.421 Y83.915 E-.41065
G1 X73.954 Y83.915 E-.20264
G1 X73.681 Y84.188 E-.14671
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X72.164 Y89.561 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.198484
G1 F15000
M204 S6000
G1 X72.051 Y89.713 E.00241
; LINE_WIDTH: 0.154362
G1 X71.937 Y89.866 E.00172
; LINE_WIDTH: 0.11024
G1 X71.824 Y90.018 E.00104
M204 S10000
G1 X71.54 Y90.719 F42000
; LINE_WIDTH: 0.198482
G1 F15000
M204 S6000
G1 X71.426 Y90.871 E.00241
; LINE_WIDTH: 0.154353
G1 X71.313 Y91.023 E.00172
; LINE_WIDTH: 0.110225
G1 X71.2 Y91.175 E.00104
M204 S10000
G1 X70.915 Y91.876 F42000
; LINE_WIDTH: 0.19848
G1 F15000
M204 S6000
G1 X70.802 Y92.028 E.00241
; LINE_WIDTH: 0.154352
G1 X70.689 Y92.181 E.00172
; LINE_WIDTH: 0.110225
G1 X70.575 Y92.333 E.00104
M204 S10000
G1 X70.291 Y93.034 F42000
; LINE_WIDTH: 0.19848
G1 F15000
M204 S6000
G1 X70.178 Y93.186 E.00241
; LINE_WIDTH: 0.154352
G1 X70.064 Y93.338 E.00172
; LINE_WIDTH: 0.110225
G1 X69.951 Y93.49 E.00104
M204 S10000
G1 X69.667 Y94.191 F42000
; LINE_WIDTH: 0.198491
G1 F15000
M204 S6000
G1 X69.553 Y94.344 E.00241
; LINE_WIDTH: 0.154359
G1 X69.44 Y94.496 E.00172
; LINE_WIDTH: 0.110227
G1 X69.327 Y94.648 E.00104
M204 S10000
G1 X68.797 Y95.625 F42000
; LINE_WIDTH: 0.102791
G1 F15000
M204 S6000
G3 X68.761 Y95.489 I2.027 J-.608 E.00069
M204 S10000
G1 X72.101 Y95.128 F42000
; LINE_WIDTH: 0.113003
G1 F15000
M204 S6000
M73 P79 R2
G1 X71.976 Y95.298 E.0012
; LINE_WIDTH: 0.162676
G1 X71.851 Y95.467 E.00206
; LINE_WIDTH: 0.212349
G1 X71.725 Y95.637 E.00291
; LINE_WIDTH: 0.262022
G1 X71.6 Y95.806 E.00376
M204 S10000
G1 X72.701 Y93.995 F42000
; LINE_WIDTH: 0.110088
G1 F15000
M204 S6000
G1 X72.591 Y94.144 E.00101
; LINE_WIDTH: 0.153965
G1 X72.481 Y94.292 E.00167
; LINE_WIDTH: 0.197843
G1 X72.371 Y94.441 E.00233
M204 S10000
G1 X73.301 Y92.861 F42000
; LINE_WIDTH: 0.110088
G1 F15000
M204 S6000
G1 X73.191 Y93.01 E.00101
; LINE_WIDTH: 0.153965
G1 X73.082 Y93.159 E.00167
; LINE_WIDTH: 0.197843
G1 X72.972 Y93.308 E.00233
M204 S10000
G1 X73.981 Y91.661 F42000
; LINE_WIDTH: 0.116976
G1 F15000
M204 S6000
G3 X73.866 Y91.777 I-.245 J-.13 E.001
; LINE_WIDTH: 0.119472
G1 X73.768 Y91.909 E.00103
; LINE_WIDTH: 0.159596
G1 X73.67 Y92.042 E.00157
; LINE_WIDTH: 0.19972
G1 X73.572 Y92.174 E.00211
; WIPE_START
G1 X73.67 Y92.042 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.594 Y85.495 Z2.4 F42000
G1 X78.553 Y83.896 Z2.4
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.148637
G1 F15000
M204 S6000
G3 X78.546 Y84.39 I-2.726 J.208 E.00426
; WIPE_START
G1 X78.553 Y83.896 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.916 Y91.502 Z2.4 F42000
G1 X77.897 Y91.727 Z2.4
G1 Z2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X77.897 Y84.476 E.22282
G1 X76.049 Y84.476 E.0568
G1 X76.049 Y88.337 E.11864
G1 X77.869 Y91.674 E.11681
M204 S10000
G1 X77.52 Y90.248 F42000
G1 F15000
M204 S6000
G1 X77.52 Y84.853 E.16578
G1 X76.426 Y84.853 E.03363
G1 X76.426 Y88.241 E.1041
G1 X77.492 Y90.195 E.0684
M204 S10000
G1 X77.153 Y88.805 F42000
; LINE_WIDTH: 0.40157
G1 F15000
M204 S6000
G1 X77.153 Y85.22 E.10475
G1 X76.794 Y85.22 E.01048
G1 X76.794 Y88.147 E.08553
G1 X77.124 Y88.752 E.02014
; WIPE_START
G1 X76.794 Y88.147 E-.26191
G1 X76.794 Y86.836 E-.49809
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.244 Y94.03 Z2.4 F42000
G1 X74.021 Y94.66 Z2.4
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.53502
G1 F12802.276
M204 S6000
G2 X74.021 Y94.765 I-.025 J.053 E.00948
M204 S10000
G1 X74.714 Y95.147 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X73.988 Y93.787 E.04738
G1 X73.268 Y95.147 E.04731
G1 X74.654 Y95.147 E.04259
M204 S10000
G1 X75.342 Y95.524 F42000
G1 F15000
M204 S6000
G1 X73.987 Y92.983 E.0885
G1 X72.642 Y95.524 E.08837
G1 X75.282 Y95.524 E.08114
; WIPE_START
G1 X73.282 Y95.524 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X76.243 Y95.963 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.34189
G1 F15000
M204 S6000
G1 X81.43 Y95.963 E.12638
M204 S10000
G1 X71.744 Y95.963 F42000
G1 F15000
M204 S6000
G1 X67.906 Y95.963 E.09349
M204 S10000
G1 X67.906 Y96.03 F42000
; LINE_WIDTH: 0.166336
G1 F15000
M204 S6000
G1 X68.238 Y96.071 E.00337
; LINE_WIDTH: 0.119206
G1 X68.571 Y96.113 E.00208
M204 S10000
G1 X68.894 Y95.275 F42000
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.38292
G1 F15000
M204 S6000
G1 X72.567 Y88.465 E.21437
G1 X72.575 Y84.352 E.11397
; WIPE_START
G1 X72.571 Y86.352 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X69.662 Y93.408 Z2.4 F42000
G1 X68.732 Y95.665 Z2.4
G1 Z2
G1 E.8 F1800
G1 F15000
M204 S6000
G1 X68.668 Y95.701 E.00204
G1 X68.717 Y95.73 E.00155
; WIPE_START
G1 X68.668 Y95.701 E-.32875
G1 X68.732 Y95.665 E-.43125
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X68.465 Y94.743 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; Slow Down Start
; FEATURE: Floating vertical shell
; LINE_WIDTH: 0.383246
G1 F3000;_EXTRUDE_SET_SPEED
M204 S6000
G1 X68.465 Y84.605 E.28115
G1 X68.492 Y84.474 E.00374
G1 X68.624 Y84.446 E.00374
G1 X71.884 Y84.446 E.09041
; Slow Down End
M204 S10000
G1 X68.828 Y85.808 F42000
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X68.827 Y84.809 E.03313
G1 X69.457 Y84.809 E.02088
G1 X71.959 Y87.311 E.11737
G1 X71.959 Y85.013 E.07621
G1 X68.828 Y88.145 E.1469
G1 X68.828 Y91.855 E.1231
G1 X69.615 Y92.642 E.03692
G1 X70.388 Y91.209 E.05401
; WIPE_START
G1 X69.615 Y92.642 E-.61876
G1 X69.352 Y92.38 E-.14124
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X76.905 Y93.475 Z2.4 F42000
G1 X94.203 Y95.984 Z2.4
G1 Z2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.29964
G1 F15000
M204 S6000
G1 X96.298 Y95.984 E.04383
; WIPE_START
G1 X94.298 Y95.984 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X98.868 Y93.234 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.51568
G1 F13326
M204 S6000
G1 X98.285 Y94.722 E.06157
G1 X98.868 Y94.722 E.02245
G1 X98.868 Y93.294 E.05502
M204 S10000
G1 X97.662 Y95.147 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X99.293 Y95.147 E.0501
G1 X99.293 Y90.984 E.12791
G1 X97.684 Y95.092 E.13553
M204 S10000
G1 X97.11 Y95.524 F42000
G1 F15000
M204 S6000
G1 X99.67 Y95.524 E.07867
G1 X99.67 Y89.807 E.17567
G1 X99.371 Y89.751 E.00934
G1 X97.132 Y95.469 E.18868
; WIPE_START
G1 X97.861 Y93.606 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X100.258 Y95.963 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.34189
G1 F15000
M204 S6000
G1 X102.854 Y95.963 E.06324
; WIPE_START
G1 X100.854 Y95.963 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X103.842 Y95.524 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X106.502 Y95.524 E.08171
G1 X106.503 Y91.445 E.12534
G1 X103.875 Y95.474 E.1478
M204 S10000
G1 X104.539 Y95.147 F42000
G1 F15000
M204 S6000
G1 X106.125 Y95.147 E.04874
G1 X106.126 Y92.714 E.07476
G1 X104.571 Y95.097 E.08741
M204 S10000
G1 X105.227 Y94.774 F42000
; LINE_WIDTH: 0.41175
G1 F15000
M204 S6000
G1 X105.752 Y94.774 E.01577
G1 X105.752 Y93.969 E.0242
G1 X105.26 Y94.724 E.02708
; WIPE_START
G1 X105.752 Y93.969 E-.34244
G1 X105.752 Y94.774 E-.30592
G1 X105.458 Y94.774 E-.11164
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X111.55 Y94.569 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X111.55 Y95.568 E.03313
G1 X110.92 Y95.568 E.02088
G1 X110.503 Y95.151 E.01957
G1 X110.503 Y92.525 E.08712
G1 X111.55 Y91.478 E.0491
G1 X111.55 Y88.522 E.09807
G1 X110.503 Y87.475 E.0491
G1 X110.503 Y84.849 E.08712
G1 X110.92 Y84.432 E.01957
G1 X111.55 Y84.432 E.02088
G1 X111.55 Y85.431 E.03313
; WIPE_START
G1 X111.55 Y84.432 E-.37956
G1 X110.92 Y84.432 E-.23921
G1 X110.657 Y84.695 E-.14124
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X104.606 Y85.277 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.64536
G1 F10457.473
M204 S6000
G2 X104.614 Y85.394 I-.034 J.061 E.01479
M204 S10000
G1 X104.079 Y86.992 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X105.472 Y84.853 E.07844
G1 X104.079 Y84.853 E.04281
G1 X104.079 Y86.932 E.06389
M204 S10000
G1 X103.702 Y88.262 F42000
G1 F15000
M204 S6000
G1 X106.167 Y84.476 E.13883
G1 X103.702 Y84.476 E.07577
G1 X103.702 Y88.202 E.11449
; WIPE_START
G1 X103.702 Y86.202 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X99.999 Y87.246 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.45606
G1 F15000
M204 S6000
G1 X100.029 Y87.089 E.00538
; LINE_WIDTH: 0.408174
G1 X100.058 Y86.932 E.00475
; LINE_WIDTH: 0.360289
G1 X100.088 Y86.775 E.00413
; LINE_WIDTH: 0.312404
G1 X100.117 Y86.618 E.00351
; LINE_WIDTH: 0.264519
G1 X100.147 Y86.461 E.00288
; LINE_WIDTH: 0.216633
G1 X100.177 Y86.304 E.00226
; LINE_WIDTH: 0.168748
G1 X100.206 Y86.147 E.00164
; LINE_WIDTH: 0.120863
G1 X100.236 Y85.99 E.00101
; WIPE_START
G1 X100.206 Y86.147 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X99.836 Y88.106 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; LINE_WIDTH: 0.121506
G1 F15000
M204 S6000
G1 X99.806 Y88.267 E.00105
; LINE_WIDTH: 0.170679
G1 X99.776 Y88.428 E.00171
; LINE_WIDTH: 0.219851
G1 X99.745 Y88.589 E.00236
; LINE_WIDTH: 0.269023
G1 X99.715 Y88.75 E.00302
; LINE_WIDTH: 0.318195
G1 X99.684 Y88.911 E.00367
; LINE_WIDTH: 0.367367
G1 X99.654 Y89.072 E.00433
; LINE_WIDTH: 0.41654
G1 X99.624 Y89.233 E.00499
; LINE_WIDTH: 0.465712
G1 F14900.964
G1 X99.593 Y89.394 E.00564
; WIPE_START
G1 X99.624 Y89.233 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.736 Y85.735 Z2.4 F42000
G1 Z2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.505635
G1 F13615.295
M204 S6000
G1 X95.708 Y85.735 E.03664
G1 X95.889 Y85.273 E.01874
G1 X94.557 Y85.272 E.05022
G1 X94.715 Y85.679 E.01645
M204 S10000
G1 X94.448 Y86.155 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X95.994 Y86.155 E.0475
G1 X96.504 Y84.853 E.04298
G1 X93.945 Y84.853 E.07865
G1 X94.427 Y86.099 E.04107
M204 S10000
G1 X94.19 Y86.532 F42000
G1 F15000
M204 S6000
G1 X96.252 Y86.532 E.06335
G1 X97.057 Y84.476 E.06787
G1 X93.394 Y84.476 E.11254
G1 X94.168 Y86.476 E.06591
; CHANGE_LAYER
; Z_HEIGHT: 2.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15000
G1 X93.447 Y84.611 E-.76
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 11/15
; update layer progress
M73 L11
M991 S0 P10 ;notify layer change
M106 S201.45
; OBJECT_ID: 110
M204 S10000
G17
G3 Z2.4 I.137 J-1.209 P1  F42000
G1 X88.8 Y84.083 Z2.4
G1 Z2.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X86.291 Y88.394 E.16545
G1 X85.118 Y88.394 E.03892
G1 X85.118 Y84.083 E.14299
G1 X88.74 Y84.083 E.12017
; WIPE_START
G1 X87.752 Y85.822 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.601 Y85 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X88.044 Y89.23 E.15188
G3 X89.639 Y90.564 I-1.051 J2.878 E.06521
G3 X89.967 Y92.491 I-3.061 J1.513 E.0609
G3 X88.261 Y94.808 I-2.638 J-.156 E.0935
G3 X86.126 Y95.142 I-2.026 J-5.964 E.06674
G1 X83.125 Y95.142 E.09221
G1 X83.125 Y84.561 E.32513
G1 X84.726 Y84.561 E.04919
G1 X84.726 Y88.786 E.12984
G1 X86.517 Y88.786 E.05503
G1 X88.976 Y84.561 E.15023
G1 X92.077 Y84.561 E.09526
G1 X93.326 Y87.792 E.10646
G1 X97.111 Y87.792 E.1163
G1 X98.377 Y84.561 E.10663
G1 X100.051 Y84.561 E.05144
G1 X95.89 Y95.184 E.35058
M73 P80 R2
G1 X94.61 Y95.184 E.03934
G1 X90.623 Y85.056 E.33447
; WIPE_START
M204 S6000
G1 X89.571 Y86.757 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X83.626 Y91.544 Z2.6 F42000
G1 X79.157 Y95.142 Z2.6
G1 Z2.2
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X79.157 Y84.561 E.32513
G1 X80.758 Y84.561 E.04919
G1 X80.758 Y95.142 E.32513
G1 X79.217 Y95.142 E.04735
; WIPE_START
M204 S6000
G1 X79.206 Y93.142 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X73.984 Y90.298 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X71.419 Y95.142 E.16843
G1 X69.648 Y95.142 E.0544
G1 X73.175 Y88.603 E.22829
G1 X73.175 Y84.561 E.12421
G1 X74.789 Y84.561 E.0496
G1 X74.789 Y88.658 E.1259
G1 X78.324 Y95.142 E.22692
G1 X76.566 Y95.142 E.05403
G1 X74.012 Y90.351 E.16683
; WIPE_START
M204 S6000
G1 X73.06 Y92.109 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X72.783 Y88.073 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X72.783 Y88.504 E.01428
G1 X68.991 Y95.534 E.26496
G1 X71.655 Y95.534 E.08835
G1 X73.985 Y91.133 E.16518
G1 X76.331 Y95.534 E.16542
G1 X81.15 Y95.534 E.15988
G1 X81.15 Y84.083 E.37983
G1 X82.733 Y84.083 E.05249
G1 X82.733 Y95.534 E.37983
G1 X86.134 Y95.534 E.11282
G2 X88.404 Y95.174 I.107 J-6.654 E.07664
G2 X90.358 Y92.529 I-1.074 J-2.838 E.11528
G2 X89.984 Y90.377 I-3.778 J-.452 E.07347
G2 X88.604 Y89.06 I-2.859 J1.614 E.06421
G1 X90.526 Y85.881 E.12322
G1 X94.343 Y95.576 E.34563
G1 X96.157 Y95.576 E.0602
G1 X100.339 Y84.901 E.38032
G1 X100.538 Y84.938 E.00671
G1 X100.538 Y95.534 E.35148
G1 X102.8 Y95.534 E.07505
G1 X107.197 Y88.793 E.26697
G1 X107.372 Y88.845 E.00604
G1 X107.369 Y95.534 E.22189
G1 X109.679 Y95.534 E.07662
G1 X109.679 Y84.083 E.37983
G1 X111.898 Y84.083 E.0736
G1 X111.898 Y95.917 E.39252
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X72.783 Y84.083 E.15527
G1 X72.783 Y88.013 E.13036
; WIPE_START
G1 X72.783 Y88.504 E-.18639
G1 X72.066 Y89.832 E-.57361
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.22 Y94.347 Z2.6 F42000
G1 X78.765 Y94.747 Z2.6
G1 Z2.2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X78.581 Y94.794 E.0063
G1 X75.181 Y88.558 E.23562
G1 X75.181 Y84.083 E.14843
G1 X78.765 Y84.083 E.11889
G1 X78.765 Y94.687 E.35175
; WIPE_START
G1 X78.581 Y94.794 E-.08083
G1 X77.726 Y93.225 E-.67918
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.193 Y89.172 Z2.6 F42000
G1 X92.312 Y84.083 Z2.6
G1 Z2.2
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X98.142 Y84.083 E.1934
G1 X96.844 Y87.4 E.11815
G1 X93.595 Y87.4 E.10776
G1 X92.334 Y84.139 E.11597
; WIPE_START
G1 X94.334 Y84.12 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.785 Y85.774 Z2.6 F42000
G1 X107.824 Y87.114 Z2.6
G1 Z2.2
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X102.588 Y95.142 E.29453
G1 X100.93 Y95.142 E.05095
G1 X100.93 Y84.561 E.32513
G1 X102.442 Y84.561 E.04646
G1 X102.442 Y90.548 E.18399
G3 X102.371 Y92.614 I-28.136 J.064 E.06352
G1 X107.616 Y84.561 E.29531
G1 X109.287 Y84.561 E.05136
G1 X109.287 Y95.142 E.32513
G1 X107.762 Y95.142 E.04687
G1 X107.764 Y88.513 E.20368
G3 X107.821 Y87.173 I52.088 J1.55 E.04121
; WIPE_START
M204 S6000
G1 X106.723 Y88.845 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.458 Y84.083 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X103.003 Y90.924 E.2708
G1 X102.827 Y90.87 E.00611
G1 X102.834 Y84.083 E.22512
G1 X107.398 Y84.083 E.15142
; WIPE_START
G1 X106.317 Y85.766 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X110.08 Y92.407 Z2.6 F42000
G1 X112.29 Y96.309 Z2.6
G1 Z2.2
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.6 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z2.6
M106 S255
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z2.6 F4000
            G39.3 S1
            G0 Z2.6 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X105.346 Y94.403 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.40139
G1 F15000
M204 S6000
G1 X105.856 Y94.403 E.0149
G1 X105.856 Y93.62 E.02286
G1 X105.379 Y94.352 E.02554
M204 S10000
G1 X104.667 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X106.224 Y94.77 E.04783
G1 X106.224 Y92.382 E.07337
G1 X104.7 Y94.72 E.08576
M204 S10000
G1 X103.971 Y95.147 F42000
G1 F15000
M204 S6000
G1 X106.6 Y95.147 E.0808
G1 X106.602 Y91.113 E.12395
G1 X104.003 Y95.097 E.14614
M204 S10000
G1 X103.275 Y95.524 F42000
G1 F15000
M204 S6000
G1 X106.977 Y95.524 E.11378
G1 X106.979 Y89.844 E.17453
G1 X103.307 Y95.474 E.20653
; WIPE_START
G1 X104.4 Y93.799 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X98.955 Y92.773 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; LINE_WIDTH: 0.53875
G1 F12705.968
M204 S6000
G1 X98.344 Y94.334 E.06772
G1 X98.955 Y94.334 E.0247
G1 X98.955 Y92.833 E.06063
M204 S10000
G1 X97.704 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X99.392 Y94.77 E.05185
G1 X99.392 Y90.462 E.13238
G1 X97.726 Y94.714 E.14032
M204 S10000
M73 P81 R2
G1 X97.151 Y95.147 F42000
G1 F15000
M204 S6000
G1 X99.769 Y95.147 E.08042
G1 X99.769 Y88.465 E.20531
G1 X97.173 Y95.092 E.21865
M204 S10000
G1 X96.599 Y95.524 F42000
G1 F15000
M204 S6000
G1 X100.146 Y95.524 E.10898
G1 X100.146 Y87.288 E.25307
G1 X99.847 Y87.232 E.00934
G1 X96.621 Y95.469 E.27181
; WIPE_START
G1 X97.35 Y93.606 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X91.793 Y93.39 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; LINE_WIDTH: 0.51728
G1 F13281.053
M204 S6000
G3 X91.468 Y94.345 I-3.696 J-.724 E.03908
G1 X92.168 Y94.345 E.02706
G1 X91.815 Y93.446 E.03733
M204 S10000
G1 X91.49 Y91.459 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X91.504 Y92.551 E.03356
G1 X91.344 Y93.468 E.02861
G1 X91.048 Y94.248 E.02563
G1 X90.724 Y94.77 E.01889
G1 X92.794 Y94.77 E.06359
G1 X91.512 Y91.515 E.10751
M204 S10000
G1 X90.319 Y90.173 F42000
G1 F15000
M204 S6000
G1 X90.598 Y90.834 E.02205
G1 X90.749 Y91.594 E.02379
G1 X90.749 Y92.549 E.02935
G1 X90.604 Y93.326 E.02431
G1 X90.349 Y93.965 E.02113
G1 X89.987 Y94.516 E.02025
G1 X89.52 Y94.981 E.02026
G1 X89.199 Y95.2 E.01192
G1 X89.261 Y95.524 E.01016
G1 X93.901 Y95.524 E.14257
G1 X90.452 Y86.762 E.28935
G1 X89.141 Y88.93 E.07786
G1 X89.424 Y89.124 E.01056
G1 X89.916 Y89.594 E.0209
G1 X90.285 Y90.124 E.01982
M204 S10000
G1 X90.683 Y89.923 F42000
; LINE_WIDTH: 0.54106
G1 F12647.048
M204 S6000
G1 X90.998 Y90.668 E.03285
; LINE_WIDTH: 0.51359
G1 F13385.175
G1 X91.038 Y90.953 E.01102
; LINE_WIDTH: 0.47615
G1 F14541.93
G1 X91.079 Y91.237 E.01014
; LINE_WIDTH: 0.420445
G1 F15000
G1 X91.119 Y91.522 E.00884
G1 X91.126 Y92.55 E.03163
G1 X90.974 Y93.397 E.02649
G1 X90.699 Y94.107 E.02341
G1 X90.301 Y94.725 E.02261
G1 X89.888 Y95.147 E.01817
G1 X93.347 Y95.147 E.1064
G1 X91.838 Y91.313 E.12679
; LINE_WIDTH: 0.439369
G1 X91.73 Y91.091 E.00796
; LINE_WIDTH: 0.478125
G1 F14475.937
G1 X91.622 Y90.87 E.00873
; LINE_WIDTH: 0.532795
G1 F12860.442
G1 X91.514 Y90.649 E.00983
G1 X91.2 Y89.855 E.03407
; LINE_WIDTH: 0.518757
G1 F13239.836
G1 X91.115 Y89.584 E.01101
; LINE_WIDTH: 0.47925
G1 F14438.612
G1 X91.029 Y89.313 E.0101
; LINE_WIDTH: 0.421404
G1 F15000
G1 X90.944 Y89.042 E.00876
G1 X90.38 Y87.609 E.04749
G1 X89.647 Y88.821 E.04368
G1 X90.177 Y89.322 E.02246
; LINE_WIDTH: 0.441627
G1 X90.333 Y89.507 E.00786
; LINE_WIDTH: 0.4849
G1 F14254.039
G1 X90.488 Y89.692 E.00872
; LINE_WIDTH: 0.528174
G1 F12982.909
G1 X90.644 Y89.877 E.00957
M204 S10000
G1 X90.784 Y89.577 F42000
; LINE_WIDTH: 0.35449
G1 F15000
M204 S6000
G1 X90.315 Y88.383 E.03257
G1 X90.087 Y88.76 E.01117
G1 X90.536 Y89.215 E.01623
G1 X90.75 Y89.528 E.00963
; WIPE_START
G1 X90.536 Y89.215 E-.14407
G1 X90.087 Y88.76 E-.24291
G1 X90.315 Y88.383 E-.16714
G1 X90.513 Y88.887 E-.20587
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.621 Y85.903 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; LINE_WIDTH: 0.366415
G1 F15000
M204 S6000
G1 X95.823 Y85.903 E.03168
G1 X95.949 Y85.58 E.00916
G1 X94.496 Y85.58 E.03832
G1 X94.599 Y85.848 E.00756
M204 S10000
G1 X94.381 Y86.254 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X96.062 Y86.254 E.05165
G1 X96.463 Y85.23 E.03379
G1 X93.985 Y85.23 E.07614
G1 X94.359 Y86.198 E.03189
M204 S10000
G1 X94.122 Y86.631 F42000
G1 F15000
M204 S6000
G1 X96.319 Y86.631 E.06749
G1 X97.015 Y84.853 E.05868
G1 X93.435 Y84.853 E.11002
G1 X94.101 Y86.575 E.05674
M204 S10000
G1 X93.864 Y87.008 F42000
G1 F15000
M204 S6000
G1 X96.576 Y87.008 E.08334
G1 X97.568 Y84.476 E.08356
G1 X92.884 Y84.476 E.14391
G1 X93.842 Y86.952 E.08158
; WIPE_START
G1 X93.121 Y85.087 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X92.119 Y84.126 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X89.003 Y84.126 E.12115
; WIPE_START
G1 X91.003 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X86.269 Y86.144 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42967
G1 F15000
M204 S6000
G1 X86.799 Y85.235 E.03318
G1 X86.269 Y85.235 E.01669
G1 X86.269 Y86.084 E.02679
M204 S10000
G1 X85.887 Y87.56 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.463 Y84.853 E.09625
G1 X85.887 Y84.853 E.04842
G1 X85.887 Y87.5 E.08134
M204 S10000
G1 X86.066 Y88.002 F42000
G1 F15000
M204 S6000
G1 X88.119 Y84.476 E.12538
G1 X85.51 Y84.476 E.08016
G1 X85.51 Y88.002 E.10836
G1 X86.006 Y88.002 E.01524
; WIPE_START
G1 X85.51 Y88.002 E-.18845
G1 X85.51 Y86.498 E-.57155
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.922 Y84.126 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X82.929 Y84.126 E.07748
M204 S10000
G1 X82.341 Y84.875 F42000
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X82.341 Y84.476 E.01227
G1 X81.542 Y84.476 E.02453
G1 X81.542 Y95.524 E.33949
G1 X82.341 Y95.524 E.02453
G1 X82.341 Y84.935 E.32539
M204 S10000
G1 X81.942 Y95.125 F42000
; LINE_WIDTH: 0.46422
G1 F14953.716
M204 S6000
G1 X81.942 Y84.935 E.34985
; WIPE_START
G1 X81.942 Y86.935 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X80.954 Y84.126 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X78.961 Y84.126 E.07748
; WIPE_START
G1 X80.954 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.985 Y84.126 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
G1 F13203.395
M204 S6000
G1 X72.979 Y84.126 E.078
; WIPE_START
G1 X74.979 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X68.269 Y85.189 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Bridge
; LINE_WIDTH: 0.41356
; LAYER_HEIGHT: 0.4
G1 F3000
M204 S6000
G1 X69.005 Y84.453 E.05697
G1 X69.661 Y84.453 E.03588
G1 X68.472 Y85.642 E.09204
G1 X68.472 Y86.298 E.03588
G1 X70.316 Y84.453 E.14278
G1 X70.972 Y84.453 E.03588
G1 X68.472 Y86.953 E.19352
G1 X68.472 Y87.609 E.03588
G1 X71.628 Y84.453 E.24426
G1 X72.283 Y84.453 E.03588
G1 X68.472 Y88.265 E.295
G1 X68.472 Y88.92 E.03588
G1 X72.413 Y84.979 E.30506
G1 X72.413 Y85.634 E.03588
G1 X68.472 Y89.576 E.30506
G1 X68.472 Y90.231 E.03588
G1 X72.413 Y86.29 E.30506
G1 X72.413 Y86.946 E.03588
G1 X68.472 Y90.887 E.30506
G1 X68.472 Y91.542 E.03588
G1 X72.413 Y87.601 E.30506
G1 X72.413 Y88.257 E.03588
G1 X68.472 Y92.198 E.30506
G1 X68.472 Y92.854 E.03588
G1 X71.825 Y89.5 E.25958
G1 X71.058 Y90.923 E.08849
G1 X68.472 Y93.509 E.20017
G1 X68.472 Y94.165 E.03588
G1 X70.29 Y92.346 E.14076
G1 X69.523 Y93.769 E.08849
G1 X68.269 Y95.023 E.09703
M106 S201.45
M204 S10000
G1 X68.56 Y95.433 F42000
; FEATURE: Floating vertical shell
; LINE_WIDTH: 0.49446
; LAYER_HEIGHT: 0.2
G1 F12000
M204 S6000
G2 X68.556 Y95.531 I-.028 J.048 E.00846
; WIPE_START
G1 X68.503 Y95.531 E-.18089
G1 X68.475 Y95.482 E-.19304
G1 X68.503 Y95.433 E-.19304
G1 X68.56 Y95.433 E-.19303
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.013 Y94.347 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42844
G1 F15000
M204 S6000
G1 X73.941 Y94.389 E.00262
G1 X74.003 Y94.425 E.00225
M204 S10000
G1 X74.625 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X73.988 Y93.576 E.04157
G1 X73.356 Y94.77 E.04151
G1 X74.565 Y94.77 E.03714
M204 S10000
G1 X75.253 Y95.147 F42000
G1 F15000
M204 S6000
M73 P82 R2
G1 X73.987 Y92.773 E.08269
G1 X72.73 Y95.147 E.08257
G1 X75.193 Y95.147 E.07569
M204 S10000
G1 X75.881 Y95.524 F42000
G1 F15000
M204 S6000
G1 X73.986 Y91.969 E.1238
G1 X72.103 Y95.524 E.12362
G1 X75.821 Y95.524 E.11424
; WIPE_START
G1 X73.821 Y95.524 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.202 Y88.998 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; LINE_WIDTH: 0.5002
G1 F13777.117
M204 S6000
G1 X77.202 Y85.647 E.12488
G1 X76.745 Y85.647 E.01704
G1 X76.745 Y88.159 E.09363
G1 X77.173 Y88.946 E.03336
M204 S10000
G1 X77.619 Y90.635 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X77.619 Y85.23 E.16608
G1 X76.327 Y85.23 E.03969
G1 X76.327 Y88.266 E.09329
G1 X77.59 Y90.582 E.08106
M204 S10000
G1 X77.996 Y92.114 F42000
M73 P82 R1
G1 F15000
M204 S6000
G1 X77.996 Y84.853 E.22312
G1 X75.95 Y84.853 E.06286
G1 X75.95 Y88.362 E.10783
G1 X77.967 Y92.061 E.12947
M204 S10000
G1 X78.373 Y93.593 F42000
G1 F15000
M204 S6000
G1 X78.373 Y84.476 E.28016
G1 X75.573 Y84.476 E.08603
G1 X75.573 Y88.458 E.12237
G1 X78.344 Y93.541 E.17788
; WIPE_START
G1 X77.387 Y91.785 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.483 Y94.596 Z2.6 F42000
G1 X87.238 Y95.688 Z2.6
G1 Z2.2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.116851
G1 F15000
M204 S6000
G1 X87.565 Y95.666 E.00198
; LINE_WIDTH: 0.15696
G1 X87.744 Y95.646 E.00167
; LINE_WIDTH: 0.197236
G1 X87.917 Y95.626 E.0022
; LINE_WIDTH: 0.236999
G1 X88.091 Y95.606 E.00276
; LINE_WIDTH: 0.258329
G1 X88.101 Y95.605 E.00018
; LINE_WIDTH: 0.283481
G1 X88.246 Y95.581 E.00288
; LINE_WIDTH: 0.330913
G1 X88.391 Y95.557 E.00344
; LINE_WIDTH: 0.378344
G1 X88.536 Y95.533 E.00401
; LINE_WIDTH: 0.405397
G1 X88.852 Y95.474 E.00951
; WIPE_START
G1 X88.536 Y95.533 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.639 Y90.951 Z2.6 F42000
G1 X100.069 Y86.875 Z2.6
G1 Z2.2
G1 E.8 F1800
; LINE_WIDTH: 0.465697
G1 F14901.482
M204 S6000
G1 X100.099 Y86.714 E.00564
; LINE_WIDTH: 0.416527
G1 F15000
G1 X100.13 Y86.553 E.00499
; LINE_WIDTH: 0.367357
G1 X100.16 Y86.392 E.00433
; LINE_WIDTH: 0.318186
G1 X100.191 Y86.231 E.00367
; LINE_WIDTH: 0.269016
G1 X100.221 Y86.07 E.00302
; LINE_WIDTH: 0.219846
G1 X100.251 Y85.909 E.00236
; LINE_WIDTH: 0.170676
G1 X100.282 Y85.748 E.00171
; LINE_WIDTH: 0.121505
G1 X100.312 Y85.587 E.00105
M204 S10000
G1 X100.475 Y84.727 F42000
; LINE_WIDTH: 0.461657
G1 F15000
M204 S6000
G2 X100.536 Y84.315 I-1.479 J-.431 E.01424
; LINE_WIDTH: 0.499786
G1 F13789.601
G1 X100.536 Y84.266 E.00184
; LINE_WIDTH: 0.540684
G1 F12656.617
G1 X100.536 Y84.216 E.002
; LINE_WIDTH: 0.581581
G1 F11695.674
G1 X100.536 Y84.167 E.00217
; LINE_WIDTH: 0.58155
G1 F11696.341
G1 X100.635 Y84.147 E.00443
; LINE_WIDTH: 0.54057
G1 F12659.499
G1 X100.734 Y84.126 E.0041
; LINE_WIDTH: 0.52007
G1 F13203.395
G1 X102.638 Y84.126 E.07403
M204 S10000
G1 X100.536 Y84.167 F42000
; LINE_WIDTH: 0.581537
G1 F11696.623
M204 S6000
G1 X100.437 Y84.147 E.00443
; LINE_WIDTH: 0.521064
G1 F13175.971
G1 X100.338 Y84.126 E.00393
G1 X98.336 Y84.126 E.07799
; WIPE_START
G1 X100.336 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X104.495 Y85.647 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.62596
G1 F10805.433
M204 S6000
G2 X104.501 Y85.762 I-.033 J.06 E.01377
M204 S10000
G1 X103.977 Y87.329 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X105.344 Y85.23 E.07698
G1 X103.979 Y85.23 E.04195
G1 X103.977 Y87.269 E.06266
M204 S10000
G1 X103.598 Y88.601 F42000
G1 F15000
M204 S6000
G1 X106.04 Y84.853 E.13744
G1 X103.602 Y84.853 E.07489
G1 X103.599 Y88.541 E.11332
M204 S10000
G1 X103.22 Y89.873 F42000
G1 F15000
M204 S6000
G1 X106.735 Y84.476 E.1979
G1 X103.225 Y84.476 E.10784
G1 X103.22 Y89.813 E.16399
; WIPE_START
G1 X103.222 Y87.813 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.665 Y84.126 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X109.483 Y84.126 E.0707
; WIPE_START
G1 X107.665 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X111.506 Y85.193 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Floating vertical shell
; LINE_WIDTH: 0.41999
G1 F12000
M204 S6000
G1 X111.506 Y84.476 E.02204
G1 X110.071 Y84.476 E.04408
G1 X110.071 Y95.524 E.33949
G1 X111.506 Y95.524 E.04408
G1 X111.506 Y85.253 E.31561
M204 S10000
G1 X110.524 Y84.928 F42000
; LINE_WIDTH: 0.57172
G1 F11913.767
M204 S6000
G1 X110.524 Y95.072 E.43707
G1 X111.053 Y95.072 E.02279
G1 X111.053 Y84.928 E.43707
G1 X110.584 Y84.928 E.0202
; WIPE_START
G1 X111.053 Y84.928 E-.17814
G1 X111.053 Y86.46 E-.58186
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X103.81 Y88.868 Z2.6 F42000
G1 X95.249 Y91.714 Z2.6
G1 Z2.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X94.473 Y89.667 E.07262
G1 X96.018 Y89.667 E.05126
G1 X95.27 Y91.658 E.07055
; WIPE_START
G1 X94.527 Y89.801 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.244 Y92.908 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X94.993 Y92.144 E.02472
G1 X93.905 Y89.275 E.09429
G1 X96.584 Y89.275 E.08234
G1 X95.626 Y91.825 E.08371
G2 X95.263 Y92.851 I25.328 J9.54 E.03345
; WIPE_START
M204 S6000
G1 X94.993 Y92.144 E-.28772
G1 X94.552 Y90.982 E-.47228
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.007 Y90.036 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.37362
G1 F15000
M204 S6000
G1 X95.248 Y90.67 E.01826
G1 X95.486 Y90.036 E.01824
G1 X95.067 Y90.036 E.01127
; WIPE_START
G1 X95.486 Y90.036 E-.17934
G1 X95.248 Y90.67 E-.29016
G1 X95.007 Y90.036 E-.2905
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.758 Y92.424 Z2.6 F42000
G1 X85.118 Y93.293 Z2.6
G1 Z2.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X85.118 Y90.612 E.08894
G3 X86.567 Y90.633 I.503 J15.931 E.04809
G3 X87.583 Y90.969 I-.044 J1.834 E.03605
G3 X87.945 Y91.809 I-.839 J.859 E.03111
G3 X87.77 Y92.786 I-1.581 J.221 E.03349
G3 X87.133 Y93.176 I-.812 J-.61 E.02537
G3 X86.042 Y93.293 I-1.071 J-4.84 E.03648
G1 X85.178 Y93.293 E.02866
M204 S250
G1 X84.726 Y93.686 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X84.726 Y90.22 E.10648
G1 X86.132 Y90.22 E.04322
G1 X86.585 Y90.241 E.01391
G3 X87.836 Y90.669 I-.062 J2.224 E.04124
G3 X88.336 Y91.778 I-1.107 J1.167 E.03835
G3 X88.097 Y93.003 I-1.959 J.254 E.03902
G3 X87.235 Y93.556 I-1.137 J-.826 E.03221
G3 X86.049 Y93.686 I-1.172 J-5.221 E.03674
G1 X84.786 Y93.686 E.03881
; WIPE_START
M204 S6000
G1 X84.751 Y91.686 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.375 Y91.328 Z2.6 F42000
G1 Z2.2
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.121 Y91.151 E.00953
G1 X86.699 Y91.053 E.0133
G2 X85.51 Y91.004 I-.889 J7.153 E.03662
G1 X85.51 Y92.897 E.05815
G1 X86.469 Y92.886 E.02947
G2 X87.311 Y92.681 I-.349 J-3.274 E.02672
G1 X87.462 Y92.524 E.00667
G2 X87.551 Y92.078 I-1.167 J-.466 E.01405
G1 X87.51 Y91.587 E.01515
G1 X87.403 Y91.382 E.00712
M204 S10000
G1 X87.127 Y91.651 F42000
G1 F15000
M204 S6000
G1 X87.062 Y91.552 E.00363
G1 X86.747 Y91.435 E.01033
G2 X85.887 Y91.381 I-.756 J5.162 E.0265
G1 X85.887 Y92.515 E.03484
G1 X86.444 Y92.509 E.01711
G1 X86.872 Y92.429 E.01339
G1 X87.131 Y92.324 E.00859
G1 X87.175 Y92.046 E.00866
G1 X87.134 Y91.71 E.01038
M204 S10000
G1 X86.789 Y91.83 F42000
; LINE_WIDTH: 0.40163
G1 F15000
M204 S6000
G1 X86.255 Y91.764 E.01572
G1 X86.255 Y92.143 E.01109
G1 X86.695 Y92.1 E.01294
G1 X86.805 Y92.064 E.00336
G2 X86.795 Y91.89 I-.44 J-.064 E.00513
; CHANGE_LAYER
; Z_HEIGHT: 2.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15000
G1 X86.805 Y92.064 E-.08032
G1 X86.695 Y92.1 E-.05297
G1 X86.255 Y92.143 E-.20402
G1 X86.255 Y91.764 E-.1748
G1 X86.789 Y91.83 E-.24789
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 12/15
; update layer progress
M73 L12
M991 S0 P11 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z2.6 I1.178 J.306 P1  F42000
G1 X88.8 Y84.083 Z2.6
G1 Z2.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X86.291 Y88.394 E.16545
G1 X85.118 Y88.394 E.03892
G1 X85.118 Y84.083 E.14299
G1 X88.74 Y84.083 E.12017
; WIPE_START
G1 X87.752 Y85.822 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.601 Y85 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X88.044 Y89.23 E.15188
G3 X89.639 Y90.564 I-1.051 J2.878 E.06521
G3 X89.967 Y92.491 I-3.061 J1.513 E.0609
M73 P83 R1
G3 X88.261 Y94.808 I-2.638 J-.156 E.0935
G3 X86.126 Y95.142 I-2.026 J-5.964 E.06674
G1 X83.125 Y95.142 E.09221
G1 X83.125 Y84.561 E.32513
G1 X84.726 Y84.561 E.04919
G1 X84.726 Y88.786 E.12984
G1 X86.517 Y88.786 E.05503
G1 X88.976 Y84.561 E.15023
G1 X92.077 Y84.561 E.09526
G1 X93.326 Y87.792 E.10646
G1 X97.111 Y87.792 E.1163
G1 X98.377 Y84.561 E.10663
G1 X100.051 Y84.561 E.05144
G1 X95.89 Y95.184 E.35058
G1 X94.61 Y95.184 E.03934
G1 X90.623 Y85.056 E.33447
; WIPE_START
M204 S6000
G1 X89.571 Y86.757 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.042 Y92.018 Z2.8 F42000
G1 X80.758 Y95.142 Z2.8
G1 Z2.4
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X79.157 Y95.142 E.04919
G1 X79.157 Y84.561 E.32513
G1 X80.758 Y84.561 E.04919
G1 X80.758 Y95.082 E.32329
; WIPE_START
M204 S6000
G1 X79.157 Y95.142 E-.60877
G1 X79.157 Y94.744 E-.15123
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X73.984 Y90.298 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X71.419 Y95.142 E.16843
G1 X69.648 Y95.142 E.0544
G1 X73.175 Y88.603 E.22829
G1 X73.175 Y84.561 E.12421
G1 X74.789 Y84.561 E.0496
G1 X74.789 Y88.658 E.1259
G1 X78.324 Y95.142 E.22692
G1 X76.566 Y95.142 E.05403
G1 X74.012 Y90.351 E.16683
; WIPE_START
M204 S6000
G1 X73.06 Y92.109 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X72.783 Y88.073 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X72.783 Y88.504 E.01428
G1 X68.991 Y95.534 E.26496
G1 X71.655 Y95.534 E.08835
G1 X73.985 Y91.133 E.16518
G1 X76.331 Y95.534 E.16542
G1 X81.15 Y95.534 E.15988
G1 X81.15 Y84.083 E.37983
G1 X82.733 Y84.083 E.05249
G1 X82.733 Y95.534 E.37983
G1 X86.134 Y95.534 E.11282
G2 X88.404 Y95.173 I.107 J-6.654 E.07664
G2 X90.358 Y92.529 I-1.074 J-2.837 E.11528
G2 X89.984 Y90.377 I-3.778 J-.452 E.07347
G2 X88.604 Y89.06 I-2.859 J1.614 E.06421
G1 X90.526 Y85.881 E.12322
G1 X94.343 Y95.576 E.34563
G1 X96.157 Y95.576 E.0602
G1 X100.339 Y84.901 E.38032
G1 X100.538 Y84.938 E.00671
G1 X100.538 Y95.534 E.35148
G1 X102.8 Y95.534 E.07505
G1 X107.197 Y88.793 E.26697
G1 X107.372 Y88.845 E.00604
G1 X107.369 Y95.534 E.22189
G1 X109.679 Y95.534 E.07662
G1 X109.679 Y84.083 E.37983
G1 X111.898 Y84.083 E.0736
G1 X111.898 Y95.917 E.39252
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X72.783 Y84.083 E.15527
G1 X72.783 Y88.013 E.13036
; WIPE_START
G1 X72.783 Y88.504 E-.18639
G1 X72.066 Y89.832 E-.57361
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.22 Y94.347 Z2.8 F42000
G1 X78.765 Y94.747 Z2.8
G1 Z2.4
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X78.581 Y94.794 E.0063
G1 X75.181 Y88.558 E.23562
G1 X75.181 Y84.083 E.14843
G1 X78.765 Y84.083 E.11889
G1 X78.765 Y94.687 E.35175
; WIPE_START
G1 X78.581 Y94.794 E-.08083
G1 X77.726 Y93.225 E-.67918
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.193 Y89.172 Z2.8 F42000
G1 X92.312 Y84.083 Z2.8
G1 Z2.4
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X98.142 Y84.083 E.1934
G1 X96.844 Y87.4 E.11815
G1 X93.595 Y87.4 E.10776
G1 X92.334 Y84.139 E.11597
; WIPE_START
G1 X94.334 Y84.12 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.785 Y85.774 Z2.8 F42000
G1 X107.824 Y87.114 Z2.8
G1 Z2.4
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X102.588 Y95.142 E.29452
G1 X100.93 Y95.142 E.05095
G1 X100.93 Y84.561 E.32513
G1 X102.442 Y84.561 E.04646
G1 X102.442 Y90.548 E.18399
G3 X102.371 Y92.614 I-28.136 J.064 E.06352
G1 X107.616 Y84.561 E.29531
G1 X109.287 Y84.561 E.05136
G1 X109.287 Y95.142 E.32513
G1 X107.762 Y95.142 E.04687
G1 X107.764 Y88.513 E.20368
G3 X107.821 Y87.173 I52.091 J1.55 E.04121
; WIPE_START
M204 S6000
G1 X106.723 Y88.845 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.458 Y84.083 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X103.003 Y90.924 E.2708
G1 X102.827 Y90.87 E.00611
G1 X102.834 Y84.083 E.22512
G1 X107.398 Y84.083 E.15142
; WIPE_START
G1 X106.317 Y85.766 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X110.08 Y92.407 Z2.8 F42000
G1 X112.29 Y96.309 Z2.8
G1 Z2.4
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.8 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z2.8
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z2.8 F4000
            G39.3 S1
            G0 Z2.8 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X110.071 Y95.524 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X111.506 Y95.524 E.04408
G1 X111.506 Y84.476 E.33949
G1 X110.071 Y84.476 E.04408
G1 X110.071 Y95.464 E.33765
M204 S10000
G1 X110.524 Y95.072 F42000
; LINE_WIDTH: 0.57172
G1 F11913.767
M204 S6000
G1 X111.053 Y95.072 E.02279
G1 X111.053 Y84.928 E.43707
G1 X110.524 Y84.928 E.02279
G1 X110.524 Y95.012 E.43448
; WIPE_START
G1 X110.524 Y93.012 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X105.346 Y94.403 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; LINE_WIDTH: 0.40139
G1 F15000
M204 S6000
G1 X105.856 Y94.403 E.0149
G1 X105.856 Y93.62 E.02286
G1 X105.379 Y94.352 E.02554
M204 S10000
G1 X104.667 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X106.224 Y94.77 E.04783
G1 X106.224 Y92.382 E.07337
G1 X104.7 Y94.72 E.08576
M204 S10000
G1 X103.971 Y95.147 F42000
G1 F15000
M204 S6000
G1 X106.6 Y95.147 E.0808
G1 X106.602 Y91.113 E.12395
G1 X104.003 Y95.097 E.14614
M204 S10000
G1 X103.275 Y95.524 F42000
G1 F15000
M204 S6000
G1 X106.977 Y95.524 E.11378
G1 X106.979 Y89.844 E.17453
G1 X103.307 Y95.474 E.20653
; WIPE_START
M73 P84 R1
G1 X104.4 Y93.799 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X98.955 Y92.773 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; LINE_WIDTH: 0.53875
G1 F12705.968
M204 S6000
G1 X98.344 Y94.334 E.06772
G1 X98.955 Y94.334 E.0247
G1 X98.955 Y92.833 E.06063
M204 S10000
G1 X97.704 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X99.392 Y94.77 E.05185
G1 X99.392 Y90.462 E.13238
G1 X97.726 Y94.714 E.14032
M204 S10000
G1 X97.151 Y95.147 F42000
G1 F15000
M204 S6000
G1 X99.769 Y95.147 E.08042
G1 X99.769 Y88.465 E.20531
G1 X97.173 Y95.092 E.21865
M204 S10000
G1 X96.599 Y95.524 F42000
G1 F15000
M204 S6000
G1 X100.146 Y95.524 E.10898
G1 X100.146 Y87.288 E.25307
G1 X99.847 Y87.232 E.00934
G1 X96.621 Y95.469 E.27181
; WIPE_START
G1 X97.35 Y93.606 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X91.793 Y93.39 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; LINE_WIDTH: 0.51728
G1 F13281.053
M204 S6000
G3 X91.468 Y94.345 I-3.695 J-.724 E.03908
G1 X92.168 Y94.345 E.02706
G1 X91.815 Y93.446 E.03733
M204 S10000
G1 X91.49 Y91.459 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X91.504 Y92.551 E.03356
G1 X91.344 Y93.468 E.02861
G1 X91.048 Y94.248 E.02563
G1 X90.724 Y94.77 E.01889
G1 X92.794 Y94.77 E.06359
G1 X91.512 Y91.515 E.10751
M204 S10000
G1 X90.319 Y90.173 F42000
G1 F15000
M204 S6000
G1 X90.598 Y90.834 E.02205
G1 X90.749 Y91.594 E.02379
G1 X90.749 Y92.549 E.02935
G1 X90.604 Y93.326 E.02431
G1 X90.349 Y93.965 E.02113
G1 X89.987 Y94.516 E.02024
G1 X89.52 Y94.981 E.02026
G1 X89.199 Y95.2 E.01192
G1 X89.261 Y95.524 E.01016
G1 X93.901 Y95.524 E.14257
G1 X90.452 Y86.762 E.28935
G1 X89.141 Y88.93 E.07786
G1 X89.425 Y89.124 E.01056
G1 X89.916 Y89.594 E.02089
G1 X90.285 Y90.124 E.01982
M204 S10000
G1 X90.683 Y89.923 F42000
; LINE_WIDTH: 0.54107
G1 F12646.793
M204 S6000
G1 X90.998 Y90.668 E.03285
; LINE_WIDTH: 0.513599
G1 F13384.938
G1 X91.038 Y90.953 E.01102
; LINE_WIDTH: 0.476155
G1 F14541.762
G1 X91.079 Y91.237 E.01014
; LINE_WIDTH: 0.420445
G1 F15000
G1 X91.119 Y91.522 E.00884
G1 X91.126 Y92.55 E.03163
G1 X90.974 Y93.397 E.02649
G1 X90.699 Y94.107 E.02341
G1 X90.301 Y94.725 E.02261
G1 X89.888 Y95.147 E.01817
G1 X93.347 Y95.147 E.10641
G1 X91.838 Y91.312 E.12679
; LINE_WIDTH: 0.43937
G1 X91.73 Y91.091 E.00796
; LINE_WIDTH: 0.47813
G1 F14475.771
G1 X91.622 Y90.87 E.00873
; LINE_WIDTH: 0.532804
G1 F12860.184
G1 X91.514 Y90.649 E.00983
G1 X91.2 Y89.855 E.03407
; LINE_WIDTH: 0.518765
G1 F13239.606
G1 X91.115 Y89.584 E.01101
; LINE_WIDTH: 0.479255
G1 F14438.447
G1 X91.029 Y89.313 E.0101
; LINE_WIDTH: 0.421404
G1 F15000
G1 X90.944 Y89.042 E.00876
G1 X90.38 Y87.609 E.04749
G1 X89.647 Y88.821 E.04368
G1 X90.177 Y89.322 E.02246
; LINE_WIDTH: 0.441629
G1 X90.333 Y89.507 E.00786
; LINE_WIDTH: 0.484905
G1 F14253.877
G1 X90.488 Y89.692 E.00872
; LINE_WIDTH: 0.528182
G1 F12982.686
G1 X90.644 Y89.877 E.00957
M204 S10000
G1 X90.784 Y89.577 F42000
; LINE_WIDTH: 0.35449
G1 F15000
M204 S6000
G1 X90.315 Y88.383 E.03257
G1 X90.087 Y88.76 E.01117
G1 X90.536 Y89.215 E.01623
G1 X90.75 Y89.528 E.00963
; WIPE_START
G1 X90.536 Y89.215 E-.14413
G1 X90.087 Y88.76 E-.24289
G1 X90.315 Y88.383 E-.16714
G1 X90.513 Y88.887 E-.20584
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.621 Y85.903 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; LINE_WIDTH: 0.366415
G1 F15000
M204 S6000
G1 X95.823 Y85.903 E.03168
G1 X95.949 Y85.58 E.00916
G1 X94.496 Y85.58 E.03832
G1 X94.599 Y85.848 E.00756
M204 S10000
G1 X94.381 Y86.254 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X96.062 Y86.254 E.05165
G1 X96.463 Y85.23 E.03379
G1 X93.985 Y85.23 E.07614
G1 X94.359 Y86.198 E.03189
M204 S10000
G1 X94.122 Y86.631 F42000
G1 F15000
M204 S6000
G1 X96.319 Y86.631 E.06749
G1 X97.015 Y84.853 E.05868
G1 X93.435 Y84.853 E.11002
G1 X94.101 Y86.575 E.05674
M204 S10000
G1 X93.864 Y87.008 F42000
G1 F15000
M204 S6000
G1 X96.576 Y87.008 E.08334
G1 X97.568 Y84.476 E.08356
G1 X92.884 Y84.476 E.14391
G1 X93.842 Y86.952 E.08158
; WIPE_START
G1 X93.121 Y85.087 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X92.119 Y84.126 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X89.003 Y84.126 E.12115
; WIPE_START
G1 X91.003 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X86.269 Y86.144 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42967
G1 F15000
M204 S6000
G1 X86.799 Y85.235 E.03318
G1 X86.269 Y85.235 E.01669
G1 X86.269 Y86.084 E.02679
M204 S10000
G1 X85.887 Y87.56 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.463 Y84.853 E.09625
G1 X85.887 Y84.853 E.04842
G1 X85.887 Y87.5 E.08134
M204 S10000
G1 X86.066 Y88.002 F42000
G1 F15000
M204 S6000
G1 X88.119 Y84.476 E.12538
G1 X85.51 Y84.476 E.08016
G1 X85.51 Y88.002 E.10836
G1 X86.006 Y88.002 E.01524
; WIPE_START
G1 X85.51 Y88.002 E-.18845
G1 X85.51 Y86.498 E-.57155
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.922 Y84.126 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X82.929 Y84.126 E.07748
M204 S10000
G1 X82.341 Y84.875 F42000
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X82.341 Y84.476 E.01227
G1 X81.542 Y84.476 E.02453
G1 X81.542 Y95.524 E.33949
G1 X82.341 Y95.524 E.02453
G1 X82.341 Y84.935 E.32539
M204 S10000
G1 X81.942 Y95.125 F42000
; LINE_WIDTH: 0.46422
G1 F14953.716
M204 S6000
G1 X81.942 Y84.935 E.34985
; WIPE_START
G1 X81.942 Y86.935 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X80.954 Y84.126 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X78.961 Y84.126 E.07748
; WIPE_START
G1 X80.954 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.985 Y84.126 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
G1 F13203.395
M204 S6000
G1 X72.979 Y84.126 E.078
; WIPE_START
G1 X74.979 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X70.442 Y87.913 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.54588
G1 F12525.848
M204 S6000
G1 X70.442 Y86.484 E.05857
M204 S10000
G1 X70.882 Y88.024 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X70.882 Y85.984 E.06269
G1 X70.002 Y85.984 E.02704
G1 X70.002 Y89.656 E.11283
G1 X70.854 Y88.077 E.05512
M204 S10000
G1 X71.26 Y88.119 F42000
G1 F15000
M204 S6000
G1 X71.26 Y85.607 E.0772
G1 X69.625 Y85.607 E.05021
G1 X69.625 Y91.149 E.1703
G1 X71.231 Y88.172 E.10394
M204 S10000
G1 X71.637 Y88.214 F42000
G1 F15000
M204 S6000
G1 X71.637 Y85.23 E.09171
G1 X69.248 Y85.23 E.07338
G1 X69.248 Y92.643 E.22778
G1 X71.608 Y88.267 E.15275
M204 S10000
G1 X72.014 Y88.31 F42000
G1 F15000
M204 S6000
G1 X72.014 Y84.853 E.10622
G1 X68.871 Y84.853 E.09656
G1 X68.871 Y94.136 E.28525
G1 X71.985 Y88.362 E.20157
M204 S10000
G1 X72.391 Y88.405 F42000
G1 F15000
M204 S6000
G1 X72.391 Y84.476 E.12073
G1 X68.494 Y84.476 E.11973
G1 X68.494 Y95.524 E.33949
G1 X68.561 Y95.506 E.00213
G1 X72.362 Y88.458 E.24605
; WIPE_START
M73 P85 R1
G1 X71.413 Y90.218 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.202 Y88.998 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; LINE_WIDTH: 0.5002
G1 F13777.117
M204 S6000
G1 X77.202 Y85.647 E.12488
G1 X76.745 Y85.647 E.01704
G1 X76.745 Y88.159 E.09363
G1 X77.173 Y88.946 E.03336
M204 S10000
G1 X77.619 Y90.635 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X77.619 Y85.23 E.16608
G1 X76.327 Y85.23 E.03969
G1 X76.327 Y88.266 E.09329
G1 X77.59 Y90.582 E.08106
M204 S10000
G1 X77.996 Y92.114 F42000
G1 F15000
M204 S6000
G1 X77.996 Y84.853 E.22312
G1 X75.95 Y84.853 E.06286
G1 X75.95 Y88.362 E.10783
G1 X77.967 Y92.061 E.12947
M204 S10000
G1 X78.373 Y93.593 F42000
G1 F15000
M204 S6000
G1 X78.373 Y84.476 E.28016
G1 X75.573 Y84.476 E.08603
G1 X75.573 Y88.458 E.12237
G1 X78.344 Y93.541 E.17788
; WIPE_START
G1 X77.387 Y91.785 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.013 Y94.347 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; LINE_WIDTH: 0.42844
G1 F15000
M204 S6000
G1 X73.941 Y94.389 E.00262
G1 X74.003 Y94.425 E.00225
M204 S10000
G1 X74.625 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X73.988 Y93.576 E.04157
G1 X73.356 Y94.77 E.04151
G1 X74.565 Y94.77 E.03714
M204 S10000
G1 X75.253 Y95.147 F42000
G1 F15000
M204 S6000
G1 X73.987 Y92.773 E.08269
G1 X72.73 Y95.147 E.08257
G1 X75.193 Y95.147 E.07569
M204 S10000
G1 X75.881 Y95.524 F42000
G1 F15000
M204 S6000
G1 X73.986 Y91.969 E.1238
G1 X72.103 Y95.524 E.12362
G1 X75.821 Y95.524 E.11424
; WIPE_START
G1 X73.821 Y95.524 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X81.453 Y95.617 Z2.8 F42000
G1 X87.238 Y95.688 Z2.8
G1 Z2.4
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.116851
G1 F15000
M204 S6000
G1 X87.565 Y95.666 E.00198
; LINE_WIDTH: 0.156956
G1 X87.744 Y95.646 E.00167
; LINE_WIDTH: 0.197226
G1 X87.917 Y95.626 E.0022
; LINE_WIDTH: 0.236982
G1 X88.091 Y95.606 E.00276
; LINE_WIDTH: 0.258309
G1 X88.101 Y95.605 E.00018
; LINE_WIDTH: 0.283475
G1 X88.246 Y95.581 E.00288
; LINE_WIDTH: 0.330933
G1 X88.391 Y95.557 E.00345
; LINE_WIDTH: 0.378391
G1 X88.536 Y95.533 E.00401
; LINE_WIDTH: 0.405453
G1 X88.852 Y95.474 E.00951
; WIPE_START
G1 X88.536 Y95.533 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.64 Y90.951 Z2.8 F42000
G1 X100.069 Y86.875 Z2.8
G1 Z2.4
G1 E.8 F1800
; LINE_WIDTH: 0.465697
G1 F14901.482
M204 S6000
G1 X100.099 Y86.714 E.00564
; LINE_WIDTH: 0.416527
G1 F15000
G1 X100.13 Y86.553 E.00499
; LINE_WIDTH: 0.367357
G1 X100.16 Y86.392 E.00433
; LINE_WIDTH: 0.318186
G1 X100.191 Y86.231 E.00367
; LINE_WIDTH: 0.269016
G1 X100.221 Y86.07 E.00302
; LINE_WIDTH: 0.219846
G1 X100.251 Y85.909 E.00236
; LINE_WIDTH: 0.170676
G1 X100.282 Y85.748 E.00171
; LINE_WIDTH: 0.121505
G1 X100.312 Y85.587 E.00105
M204 S10000
G1 X100.475 Y84.727 F42000
; LINE_WIDTH: 0.461657
G1 F15000
M204 S6000
G2 X100.536 Y84.315 I-1.479 J-.431 E.01424
; LINE_WIDTH: 0.499786
G1 F13789.601
G1 X100.536 Y84.266 E.00184
; LINE_WIDTH: 0.540684
G1 F12656.617
G1 X100.536 Y84.216 E.002
; LINE_WIDTH: 0.581581
G1 F11695.674
G1 X100.536 Y84.167 E.00217
; LINE_WIDTH: 0.58155
G1 F11696.341
G1 X100.635 Y84.147 E.00443
; LINE_WIDTH: 0.54057
G1 F12659.499
G1 X100.734 Y84.126 E.0041
; LINE_WIDTH: 0.52007
G1 F13203.395
G1 X102.638 Y84.126 E.07403
M204 S10000
G1 X100.536 Y84.167 F42000
; LINE_WIDTH: 0.581537
G1 F11696.623
M204 S6000
G1 X100.437 Y84.147 E.00443
; LINE_WIDTH: 0.521064
G1 F13175.971
G1 X100.338 Y84.126 E.00393
G1 X98.336 Y84.126 E.07799
; WIPE_START
G1 X100.336 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X104.495 Y85.647 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.62596
G1 F10805.433
M204 S6000
G2 X104.501 Y85.762 I-.033 J.06 E.01377
M204 S10000
G1 X103.977 Y87.329 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X105.344 Y85.23 E.07698
G1 X103.979 Y85.23 E.04195
G1 X103.977 Y87.269 E.06266
M204 S10000
G1 X103.598 Y88.601 F42000
G1 F15000
M204 S6000
G1 X106.04 Y84.853 E.13744
G1 X103.602 Y84.853 E.07489
G1 X103.599 Y88.541 E.11332
M204 S10000
G1 X103.22 Y89.873 F42000
G1 F15000
M204 S6000
G1 X106.735 Y84.476 E.1979
G1 X103.225 Y84.476 E.10784
G1 X103.22 Y89.813 E.16399
; WIPE_START
G1 X103.222 Y87.813 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.665 Y84.126 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X109.483 Y84.126 E.0707
; WIPE_START
G1 X107.665 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.152 Y88.106 Z2.8 F42000
G1 X95.249 Y91.714 Z2.8
G1 Z2.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X94.473 Y89.667 E.07262
G1 X96.018 Y89.667 E.05126
G1 X95.496 Y91.058 E.04928
G1 X95.27 Y91.658 E.02127
; WIPE_START
G1 X94.527 Y89.801 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.244 Y92.908 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X94.993 Y92.144 E.02472
G1 X93.905 Y89.275 E.09429
G1 X96.584 Y89.275 E.08234
G1 X95.863 Y91.196 E.06304
G2 X95.263 Y92.851 I31.257 J12.255 E.05412
; WIPE_START
M204 S6000
G1 X94.993 Y92.144 E-.28774
G1 X94.552 Y90.982 E-.47226
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.007 Y90.036 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.37362
G1 F15000
M204 S6000
G1 X95.248 Y90.67 E.01826
G1 X95.486 Y90.036 E.01824
G1 X95.067 Y90.036 E.01127
; WIPE_START
G1 X95.486 Y90.036 E-.17934
G1 X95.248 Y90.67 E-.29016
G1 X95.007 Y90.036 E-.2905
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.758 Y92.424 Z2.8 F42000
G1 X85.118 Y93.293 Z2.8
G1 Z2.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X85.118 Y90.612 E.08894
G3 X86.465 Y90.628 I.503 J14.811 E.04472
G3 X87.583 Y90.969 I.03 J1.903 E.03942
G3 X87.945 Y91.809 I-.839 J.859 E.03111
G3 X87.77 Y92.786 I-1.582 J.221 E.03348
G3 X87.133 Y93.176 I-.812 J-.61 E.02538
G3 X86.042 Y93.293 I-1.071 J-4.84 E.03648
G1 X85.178 Y93.293 E.02866
M204 S250
G1 X84.726 Y93.686 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X84.726 Y90.22 E.10648
G1 X86.132 Y90.22 E.04322
G1 X86.483 Y90.236 E.01079
G3 X87.836 Y90.668 I.017 J2.28 E.04437
G3 X88.336 Y91.778 I-1.107 J1.167 E.03836
G3 X88.097 Y93.003 I-1.959 J.254 E.03902
G3 X87.235 Y93.555 I-1.137 J-.826 E.03221
G3 X86.049 Y93.686 I-1.172 J-5.221 E.03674
G1 X84.786 Y93.686 E.03881
; WIPE_START
M204 S6000
G1 X84.751 Y91.686 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.375 Y91.329 Z2.8 F42000
G1 Z2.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.121 Y91.151 E.00953
G1 X86.544 Y91.032 E.0181
G1 X85.51 Y91.009 E.03178
G1 X85.51 Y92.897 E.05801
G1 X86.469 Y92.886 E.02947
G2 X87.311 Y92.681 I-.349 J-3.273 E.02671
G1 X87.462 Y92.524 E.00667
G2 X87.551 Y92.078 I-1.166 J-.466 E.01405
G1 X87.51 Y91.587 E.01515
G1 X87.403 Y91.382 E.00711
M204 S10000
G1 X87.127 Y91.651 F42000
G1 F15000
M204 S6000
G1 X87.062 Y91.552 E.00363
G1 X86.697 Y91.429 E.01184
G1 X85.887 Y91.39 E.02491
G1 X85.887 Y92.515 E.03457
G1 X86.444 Y92.509 E.01711
G1 X86.872 Y92.429 E.01339
G1 X87.131 Y92.324 E.00859
G1 X87.175 Y92.046 E.00866
G1 X87.134 Y91.71 E.01038
M204 S10000
G1 X86.787 Y91.832 F42000
; LINE_WIDTH: 0.40578
G1 F15000
M204 S6000
G2 X86.257 Y91.765 I-.485 J1.705 E.01585
G1 X86.257 Y92.141 E.01113
G1 X86.694 Y92.098 E.01299
G1 X86.803 Y92.062 E.00338
G2 X86.793 Y91.891 I-.432 J-.062 E.00509
; CHANGE_LAYER
; Z_HEIGHT: 2.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15000
G1 X86.803 Y92.062 E-.0795
G1 X86.694 Y92.098 E-.05304
G1 X86.257 Y92.141 E-.20407
G1 X86.257 Y91.765 E-.17482
G1 X86.387 Y91.766 E-.06047
G1 X86.787 Y91.832 E-.18811
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 13/15
; update layer progress
M73 L13
M991 S0 P12 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z2.8 I1.178 J.306 P1  F42000
G1 X88.8 Y84.083 Z2.8
G1 Z2.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X86.291 Y88.394 E.16545
G1 X85.118 Y88.394 E.03892
G1 X85.118 Y84.083 E.14299
G1 X88.74 Y84.083 E.12017
; WIPE_START
G1 X87.752 Y85.822 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.601 Y85 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X88.044 Y89.23 E.15188
G3 X89.639 Y90.564 I-1.051 J2.878 E.06521
G3 X89.967 Y92.491 I-3.061 J1.513 E.0609
G3 X88.261 Y94.808 I-2.638 J-.156 E.0935
G3 X86.126 Y95.142 I-2.026 J-5.964 E.06674
G1 X83.125 Y95.142 E.09221
G1 X83.125 Y84.561 E.32513
G1 X84.726 Y84.561 E.04919
G1 X84.726 Y88.786 E.12984
G1 X86.517 Y88.786 E.05503
G1 X88.976 Y84.561 E.15023
G1 X92.077 Y84.561 E.09526
G1 X93.326 Y87.792 E.10646
G1 X97.111 Y87.792 E.1163
G1 X98.377 Y84.561 E.10663
G1 X100.051 Y84.561 E.05144
G1 X95.89 Y95.184 E.35058
G1 X94.61 Y95.184 E.03934
G1 X90.623 Y85.056 E.33447
; WIPE_START
M204 S6000
G1 X89.571 Y86.757 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.042 Y92.018 Z3 F42000
G1 X80.758 Y95.142 Z3
G1 Z2.6
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X79.157 Y95.142 E.04919
G1 X79.157 Y84.561 E.32513
G1 X80.758 Y84.561 E.04919
G1 X80.758 Y95.082 E.32329
; WIPE_START
M204 S6000
G1 X79.157 Y95.142 E-.60877
G1 X79.157 Y94.744 E-.15123
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X73.984 Y90.298 Z3 F42000
G1 Z2.6
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X71.419 Y95.142 E.16843
G1 X69.648 Y95.142 E.0544
G1 X73.175 Y88.603 E.22829
G1 X73.175 Y84.561 E.12421
G1 X74.789 Y84.561 E.0496
G1 X74.789 Y88.658 E.1259
G1 X78.324 Y95.142 E.22692
G1 X76.566 Y95.142 E.05403
G1 X74.012 Y90.351 E.16683
; WIPE_START
M204 S6000
M73 P86 R1
G1 X73.06 Y92.109 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X72.783 Y88.073 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X72.783 Y88.504 E.01428
G1 X68.991 Y95.534 E.26496
G1 X71.655 Y95.534 E.08835
G1 X73.985 Y91.133 E.16518
G1 X76.331 Y95.534 E.16542
G1 X81.15 Y95.534 E.15988
G1 X81.15 Y84.083 E.37983
G1 X82.733 Y84.083 E.05249
G1 X82.733 Y95.534 E.37983
G1 X86.134 Y95.534 E.11282
G2 X88.404 Y95.173 I.107 J-6.654 E.07664
G2 X90.358 Y92.529 I-1.074 J-2.837 E.11528
G2 X89.984 Y90.377 I-3.778 J-.452 E.07347
G2 X88.604 Y89.06 I-2.859 J1.614 E.06421
G1 X90.526 Y85.881 E.12322
G1 X94.343 Y95.576 E.34563
G1 X96.157 Y95.576 E.0602
G1 X100.339 Y84.901 E.38032
G1 X100.538 Y84.938 E.00671
G1 X100.538 Y95.534 E.35148
G1 X102.8 Y95.534 E.07505
G1 X107.197 Y88.793 E.26697
G1 X107.372 Y88.845 E.00604
G1 X107.369 Y95.534 E.22189
G1 X109.679 Y95.534 E.07662
G1 X109.679 Y84.083 E.37983
G1 X111.898 Y84.083 E.0736
G1 X111.898 Y95.917 E.39252
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X72.783 Y84.083 E.15527
G1 X72.783 Y88.013 E.13036
; WIPE_START
G1 X72.783 Y88.504 E-.18639
G1 X72.066 Y89.832 E-.57361
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.22 Y94.347 Z3 F42000
G1 X78.765 Y94.747 Z3
G1 Z2.6
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X78.581 Y94.794 E.0063
G1 X75.181 Y88.558 E.23562
G1 X75.181 Y84.083 E.14843
G1 X78.765 Y84.083 E.11889
G1 X78.765 Y94.687 E.35175
; WIPE_START
G1 X78.581 Y94.794 E-.08083
G1 X77.726 Y93.225 E-.67918
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.193 Y89.172 Z3 F42000
G1 X92.312 Y84.083 Z3
G1 Z2.6
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X98.142 Y84.083 E.1934
G1 X96.844 Y87.4 E.11815
G1 X93.595 Y87.4 E.10776
G1 X92.334 Y84.139 E.11597
; WIPE_START
G1 X94.334 Y84.12 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.785 Y85.774 Z3 F42000
G1 X107.824 Y87.114 Z3
G1 Z2.6
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X102.588 Y95.142 E.29452
G1 X100.93 Y95.142 E.05095
G1 X100.93 Y84.561 E.32513
G1 X102.442 Y84.561 E.04646
G1 X102.442 Y90.548 E.18399
G3 X102.371 Y92.614 I-28.136 J.064 E.06352
G1 X107.616 Y84.561 E.29531
G1 X109.287 Y84.561 E.05136
G1 X109.287 Y95.142 E.32513
G1 X107.762 Y95.142 E.04687
G1 X107.764 Y88.513 E.20368
G3 X107.821 Y87.173 I52.091 J1.55 E.04121
; WIPE_START
M204 S6000
G1 X106.723 Y88.845 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.458 Y84.083 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X103.003 Y90.924 E.2708
G1 X102.827 Y90.87 E.00611
G1 X102.834 Y84.083 E.22512
G1 X107.398 Y84.083 E.15142
; WIPE_START
G1 X106.317 Y85.766 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X110.08 Y92.407 Z3 F42000
G1 X112.29 Y96.309 Z3
G1 Z2.6
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z3
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z3 F4000
            G39.3 S1
            G0 Z3 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X110.071 Y95.524 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X111.506 Y95.524 E.04408
G1 X111.506 Y84.476 E.33949
G1 X110.071 Y84.476 E.04408
G1 X110.071 Y95.464 E.33765
M204 S10000
G1 X110.524 Y95.072 F42000
; LINE_WIDTH: 0.57172
G1 F11913.767
M204 S6000
G1 X111.053 Y95.072 E.02279
G1 X111.053 Y84.928 E.43707
G1 X110.524 Y84.928 E.02279
G1 X110.524 Y95.012 E.43448
; WIPE_START
G1 X110.524 Y93.012 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X105.346 Y94.403 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; LINE_WIDTH: 0.40139
G1 F15000
M204 S6000
G1 X105.856 Y94.403 E.0149
G1 X105.856 Y93.62 E.02286
G1 X105.379 Y94.352 E.02554
M204 S10000
G1 X104.667 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X106.224 Y94.77 E.04783
G1 X106.224 Y92.382 E.07337
G1 X104.7 Y94.72 E.08576
M204 S10000
G1 X103.971 Y95.147 F42000
G1 F15000
M204 S6000
G1 X106.6 Y95.147 E.0808
G1 X106.602 Y91.113 E.12395
G1 X104.003 Y95.097 E.14614
M204 S10000
G1 X103.275 Y95.524 F42000
G1 F15000
M204 S6000
G1 X106.977 Y95.524 E.11378
G1 X106.979 Y89.844 E.17453
G1 X103.307 Y95.474 E.20653
; WIPE_START
G1 X104.4 Y93.799 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X98.955 Y92.773 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; LINE_WIDTH: 0.53875
G1 F12705.968
M204 S6000
G1 X98.344 Y94.334 E.06772
M73 P87 R1
G1 X98.955 Y94.334 E.0247
G1 X98.955 Y92.833 E.06063
M204 S10000
G1 X97.704 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X99.392 Y94.77 E.05185
G1 X99.392 Y90.462 E.13238
G1 X97.726 Y94.714 E.14032
M204 S10000
G1 X97.151 Y95.147 F42000
G1 F15000
M204 S6000
G1 X99.769 Y95.147 E.08042
G1 X99.769 Y88.465 E.20531
G1 X97.173 Y95.092 E.21865
M204 S10000
G1 X96.599 Y95.524 F42000
G1 F15000
M204 S6000
G1 X100.146 Y95.524 E.10898
G1 X100.146 Y87.288 E.25307
G1 X99.847 Y87.232 E.00934
G1 X96.621 Y95.469 E.27181
; WIPE_START
G1 X97.35 Y93.606 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X91.793 Y93.39 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; LINE_WIDTH: 0.51728
G1 F13281.053
M204 S6000
G3 X91.468 Y94.345 I-3.697 J-.724 E.03908
G1 X92.168 Y94.345 E.02706
G1 X91.815 Y93.446 E.03733
M204 S10000
G1 X91.49 Y91.459 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X91.504 Y92.551 E.03356
G1 X91.344 Y93.468 E.02861
G1 X91.048 Y94.248 E.02563
G1 X90.724 Y94.77 E.01889
G1 X92.794 Y94.77 E.06359
G1 X91.512 Y91.515 E.10751
M204 S10000
G1 X90.319 Y90.173 F42000
G1 F15000
M204 S6000
G1 X90.598 Y90.834 E.02204
G1 X90.749 Y91.594 E.02379
G1 X90.749 Y92.549 E.02935
G1 X90.604 Y93.326 E.02431
G1 X90.349 Y93.965 E.02113
G1 X89.987 Y94.516 E.02024
G1 X89.52 Y94.981 E.02026
G1 X89.199 Y95.2 E.01192
G1 X89.261 Y95.524 E.01016
G1 X93.901 Y95.524 E.14257
G1 X90.452 Y86.762 E.28935
G1 X89.141 Y88.93 E.07786
G1 X89.424 Y89.124 E.01056
G1 X89.916 Y89.594 E.0209
G1 X90.285 Y90.124 E.01982
M204 S10000
G1 X90.683 Y89.923 F42000
; LINE_WIDTH: 0.54105
G1 F12647.3
M204 S6000
G1 X90.998 Y90.668 E.03284
; LINE_WIDTH: 0.513582
G1 F13385.41
G1 X91.038 Y90.953 E.01102
; LINE_WIDTH: 0.476145
G1 F14542.098
G1 X91.079 Y91.237 E.01015
; LINE_WIDTH: 0.420445
G1 F15000
G1 X91.119 Y91.522 E.00884
G1 X91.126 Y92.55 E.03163
G1 X90.974 Y93.397 E.02649
G1 X90.699 Y94.107 E.02341
G1 X90.301 Y94.725 E.02261
G1 X89.888 Y95.147 E.01817
G1 X93.347 Y95.147 E.10641
G1 X91.838 Y91.312 E.12679
; LINE_WIDTH: 0.439367
G1 X91.73 Y91.091 E.00796
; LINE_WIDTH: 0.47812
G1 F14476.104
G1 X91.622 Y90.87 E.00873
; LINE_WIDTH: 0.532788
G1 F12860.619
G1 X91.514 Y90.648 E.00983
G1 X91.2 Y89.855 E.03407
; LINE_WIDTH: 0.518757
G1 F13239.836
G1 X91.115 Y89.584 E.01101
; LINE_WIDTH: 0.47925
G1 F14438.612
G1 X91.029 Y89.313 E.0101
; LINE_WIDTH: 0.421404
G1 F15000
G1 X90.944 Y89.042 E.00876
G1 X90.38 Y87.609 E.04749
G1 X89.647 Y88.821 E.04368
G1 X90.177 Y89.322 E.02246
; LINE_WIDTH: 0.441625
G1 X90.333 Y89.507 E.00786
; LINE_WIDTH: 0.484895
G1 F14254.2
G1 X90.488 Y89.692 E.00872
; LINE_WIDTH: 0.528165
G1 F12983.133
G1 X90.644 Y89.877 E.00957
M204 S10000
G1 X90.784 Y89.577 F42000
; LINE_WIDTH: 0.35448
G1 F15000
M204 S6000
G1 X90.315 Y88.383 E.03257
G1 X90.087 Y88.76 E.01117
G1 X90.536 Y89.215 E.01623
G1 X90.75 Y89.528 E.00963
; WIPE_START
G1 X90.536 Y89.215 E-.14407
G1 X90.087 Y88.76 E-.24292
G1 X90.315 Y88.383 E-.16715
G1 X90.513 Y88.887 E-.20586
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.621 Y85.903 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; LINE_WIDTH: 0.366415
G1 F15000
M204 S6000
G1 X95.823 Y85.903 E.03168
G1 X95.949 Y85.58 E.00916
G1 X94.496 Y85.58 E.03832
G1 X94.599 Y85.848 E.00756
M204 S10000
G1 X94.381 Y86.254 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X96.062 Y86.254 E.05165
G1 X96.463 Y85.23 E.03379
G1 X93.985 Y85.23 E.07614
G1 X94.359 Y86.198 E.03189
M204 S10000
G1 X94.122 Y86.631 F42000
G1 F15000
M204 S6000
G1 X96.319 Y86.631 E.06749
G1 X97.015 Y84.853 E.05868
G1 X93.435 Y84.853 E.11002
G1 X94.101 Y86.575 E.05674
M204 S10000
G1 X93.864 Y87.008 F42000
G1 F15000
M204 S6000
G1 X96.576 Y87.008 E.08334
G1 X97.568 Y84.476 E.08356
G1 X92.884 Y84.476 E.14391
G1 X93.842 Y86.952 E.08158
; WIPE_START
G1 X93.121 Y85.087 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X92.119 Y84.126 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X89.003 Y84.126 E.12115
; WIPE_START
G1 X91.003 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X86.269 Y86.144 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42967
G1 F15000
M204 S6000
G1 X86.799 Y85.235 E.03318
G1 X86.269 Y85.235 E.01669
G1 X86.269 Y86.084 E.02679
M204 S10000
G1 X85.887 Y87.56 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.463 Y84.853 E.09625
G1 X85.887 Y84.853 E.04842
G1 X85.887 Y87.5 E.08134
M204 S10000
G1 X86.066 Y88.002 F42000
G1 F15000
M204 S6000
G1 X88.119 Y84.476 E.12538
G1 X85.51 Y84.476 E.08016
G1 X85.51 Y88.002 E.10836
G1 X86.006 Y88.002 E.01524
; WIPE_START
G1 X85.51 Y88.002 E-.18845
G1 X85.51 Y86.498 E-.57155
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.922 Y84.126 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X82.929 Y84.126 E.07748
M204 S10000
G1 X82.341 Y84.875 F42000
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X82.341 Y84.476 E.01227
G1 X81.542 Y84.476 E.02453
G1 X81.542 Y95.524 E.33949
G1 X82.341 Y95.524 E.02453
G1 X82.341 Y84.935 E.32539
M204 S10000
G1 X81.942 Y95.125 F42000
; LINE_WIDTH: 0.46422
G1 F14953.716
M204 S6000
G1 X81.942 Y84.935 E.34985
; WIPE_START
G1 X81.942 Y86.935 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X80.954 Y84.126 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X78.961 Y84.126 E.07748
; WIPE_START
G1 X80.954 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.985 Y84.126 Z3 F42000
G1 Z2.6
G1 E.8 F1800
G1 F13203.395
M204 S6000
G1 X72.979 Y84.126 E.078
; WIPE_START
G1 X74.979 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X70.442 Y87.913 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.54588
G1 F12525.848
M204 S6000
G1 X70.442 Y86.484 E.05857
M204 S10000
G1 X70.882 Y88.024 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X70.882 Y85.984 E.06269
G1 X70.002 Y85.984 E.02704
G1 X70.002 Y89.656 E.11283
G1 X70.854 Y88.077 E.05512
M204 S10000
G1 X71.26 Y88.119 F42000
G1 F15000
M204 S6000
G1 X71.26 Y85.607 E.0772
G1 X69.625 Y85.607 E.05021
G1 X69.625 Y91.149 E.1703
G1 X71.231 Y88.172 E.10394
M204 S10000
G1 X71.637 Y88.214 F42000
G1 F15000
M204 S6000
G1 X71.637 Y85.23 E.09171
G1 X69.248 Y85.23 E.07338
G1 X69.248 Y92.643 E.22778
G1 X71.608 Y88.267 E.15275
M204 S10000
G1 X72.014 Y88.31 F42000
G1 F15000
M204 S6000
G1 X72.014 Y84.853 E.10622
G1 X68.871 Y84.853 E.09656
G1 X68.871 Y94.136 E.28525
G1 X71.985 Y88.362 E.20157
M204 S10000
G1 X72.391 Y88.405 F42000
G1 F15000
M204 S6000
G1 X72.391 Y84.476 E.12073
G1 X68.494 Y84.476 E.11973
G1 X68.494 Y95.524 E.33949
G1 X68.561 Y95.506 E.00213
G1 X72.362 Y88.458 E.24605
; WIPE_START
G1 X71.413 Y90.218 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.202 Y88.998 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; LINE_WIDTH: 0.5002
G1 F13777.117
M204 S6000
G1 X77.202 Y85.647 E.12488
G1 X76.745 Y85.647 E.01704
G1 X76.745 Y88.159 E.09363
G1 X77.173 Y88.946 E.03336
M204 S10000
G1 X77.619 Y90.635 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X77.619 Y85.23 E.16608
G1 X76.327 Y85.23 E.03969
G1 X76.327 Y88.266 E.09329
G1 X77.59 Y90.582 E.08106
M204 S10000
G1 X77.996 Y92.114 F42000
G1 F15000
M204 S6000
G1 X77.996 Y84.853 E.22312
G1 X75.95 Y84.853 E.06286
G1 X75.95 Y88.362 E.10783
G1 X77.967 Y92.061 E.12947
M204 S10000
G1 X78.373 Y93.593 F42000
G1 F15000
M204 S6000
G1 X78.373 Y84.476 E.28016
G1 X75.573 Y84.476 E.08603
G1 X75.573 Y88.458 E.12237
M73 P88 R1
G1 X78.344 Y93.541 E.17788
; WIPE_START
G1 X77.387 Y91.785 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.013 Y94.347 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; LINE_WIDTH: 0.42844
G1 F15000
M204 S6000
G1 X73.941 Y94.389 E.00262
G1 X74.003 Y94.425 E.00225
M204 S10000
G1 X74.625 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X73.988 Y93.576 E.04157
G1 X73.356 Y94.77 E.04151
G1 X74.565 Y94.77 E.03714
M204 S10000
G1 X75.253 Y95.147 F42000
G1 F15000
M204 S6000
G1 X73.987 Y92.773 E.08269
G1 X72.73 Y95.147 E.08257
G1 X75.193 Y95.147 E.07569
M204 S10000
G1 X75.881 Y95.524 F42000
G1 F15000
M204 S6000
G1 X73.986 Y91.969 E.1238
G1 X72.103 Y95.524 E.12362
G1 X75.821 Y95.524 E.11424
; WIPE_START
G1 X73.821 Y95.524 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X81.453 Y95.617 Z3 F42000
G1 X87.238 Y95.688 Z3
G1 Z2.6
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.116851
G1 F15000
M204 S6000
G1 X87.565 Y95.666 E.00198
; LINE_WIDTH: 0.156956
G1 X87.743 Y95.646 E.00167
; LINE_WIDTH: 0.197226
G1 X87.917 Y95.626 E.0022
; LINE_WIDTH: 0.236982
G1 X88.091 Y95.606 E.00276
; LINE_WIDTH: 0.258309
G1 X88.101 Y95.605 E.00018
; LINE_WIDTH: 0.283475
G1 X88.246 Y95.581 E.00288
; LINE_WIDTH: 0.330933
G1 X88.391 Y95.557 E.00345
; LINE_WIDTH: 0.378391
G1 X88.536 Y95.533 E.00401
; LINE_WIDTH: 0.405443
G1 X88.852 Y95.474 E.00951
; WIPE_START
G1 X88.536 Y95.533 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.64 Y90.951 Z3 F42000
G1 X100.069 Y86.875 Z3
G1 Z2.6
G1 E.8 F1800
; LINE_WIDTH: 0.465697
G1 F14901.482
M204 S6000
G1 X100.099 Y86.714 E.00564
; LINE_WIDTH: 0.416527
G1 F15000
G1 X100.13 Y86.553 E.00499
; LINE_WIDTH: 0.367357
G1 X100.16 Y86.392 E.00433
; LINE_WIDTH: 0.318186
G1 X100.191 Y86.231 E.00367
; LINE_WIDTH: 0.269016
G1 X100.221 Y86.07 E.00302
; LINE_WIDTH: 0.219846
G1 X100.251 Y85.909 E.00236
; LINE_WIDTH: 0.170676
G1 X100.282 Y85.748 E.00171
; LINE_WIDTH: 0.121505
G1 X100.312 Y85.587 E.00105
M204 S10000
G1 X100.475 Y84.727 F42000
; LINE_WIDTH: 0.461657
G1 F15000
M204 S6000
G2 X100.536 Y84.315 I-1.479 J-.431 E.01424
; LINE_WIDTH: 0.499786
G1 F13789.601
G1 X100.536 Y84.266 E.00184
; LINE_WIDTH: 0.540684
G1 F12656.617
G1 X100.536 Y84.216 E.002
; LINE_WIDTH: 0.581581
G1 F11695.674
G1 X100.536 Y84.167 E.00217
; LINE_WIDTH: 0.58155
G1 F11696.341
G1 X100.635 Y84.147 E.00443
; LINE_WIDTH: 0.54057
G1 F12659.499
G1 X100.734 Y84.126 E.0041
; LINE_WIDTH: 0.52007
G1 F13203.395
G1 X102.638 Y84.126 E.07403
M204 S10000
G1 X100.536 Y84.167 F42000
; LINE_WIDTH: 0.581537
G1 F11696.623
M204 S6000
G1 X100.437 Y84.147 E.00443
; LINE_WIDTH: 0.521064
G1 F13175.971
G1 X100.338 Y84.126 E.00393
G1 X98.336 Y84.126 E.07799
; WIPE_START
G1 X100.336 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X104.495 Y85.647 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.62596
G1 F10805.433
M204 S6000
G2 X104.501 Y85.762 I-.033 J.06 E.01377
M204 S10000
G1 X103.977 Y87.329 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X105.344 Y85.23 E.07698
G1 X103.979 Y85.23 E.04195
G1 X103.977 Y87.269 E.06266
M204 S10000
G1 X103.598 Y88.601 F42000
G1 F15000
M204 S6000
G1 X106.04 Y84.853 E.13744
G1 X103.602 Y84.853 E.07489
G1 X103.599 Y88.541 E.11332
M204 S10000
G1 X103.22 Y89.873 F42000
G1 F15000
M204 S6000
G1 X106.735 Y84.476 E.1979
G1 X103.225 Y84.476 E.10784
G1 X103.22 Y89.813 E.16399
; WIPE_START
G1 X103.222 Y87.813 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.665 Y84.126 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X109.483 Y84.126 E.0707
; WIPE_START
G1 X107.665 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.152 Y88.106 Z3 F42000
G1 X95.249 Y91.714 Z3
G1 Z2.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X94.473 Y89.667 E.07262
G1 X96.018 Y89.667 E.05126
G1 X95.27 Y91.658 E.07055
; WIPE_START
G1 X94.527 Y89.801 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.244 Y92.908 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X94.993 Y92.144 E.02472
G1 X93.905 Y89.275 E.09429
G1 X96.584 Y89.275 E.08234
G1 X95.507 Y92.143 E.09413
G2 X95.261 Y92.851 I8.265 J3.263 E.02304
; WIPE_START
M204 S6000
G1 X94.993 Y92.144 E-.2873
G1 X94.552 Y90.981 E-.4727
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.007 Y90.036 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.37362
G1 F15000
M204 S6000
G1 X95.248 Y90.67 E.01826
G1 X95.486 Y90.036 E.01824
G1 X95.067 Y90.036 E.01127
; WIPE_START
G1 X95.486 Y90.036 E-.17934
G1 X95.248 Y90.67 E-.29016
G1 X95.007 Y90.036 E-.2905
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.758 Y92.424 Z3 F42000
G1 X85.118 Y93.293 Z3
G1 Z2.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X85.118 Y90.612 E.08894
G3 X86.364 Y90.623 I.503 J13.688 E.04134
G3 X87.483 Y90.895 I-.002 J2.453 E.03856
G3 X87.945 Y91.809 I-.68 J.918 E.03525
G3 X87.77 Y92.786 I-1.582 J.221 E.03348
G3 X87.133 Y93.176 I-.812 J-.61 E.02538
G3 X86.042 Y93.293 I-1.071 J-4.84 E.03648
G1 X85.178 Y93.293 E.02866
M204 S250
G1 X84.726 Y93.686 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X84.726 Y90.22 E.10648
G1 X86.381 Y90.232 E.05088
G3 X87.7 Y90.567 I.022 J2.669 E.04227
G3 X88.336 Y91.778 I-.853 J1.221 E.04366
G3 X88.097 Y93.003 I-1.959 J.254 E.03902
G3 X87.235 Y93.556 I-1.137 J-.826 E.03221
G3 X86.049 Y93.686 I-1.172 J-5.221 E.03674
G1 X84.786 Y93.686 E.03881
; WIPE_START
M204 S6000
G1 X84.751 Y91.686 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.375 Y91.328 Z3 F42000
G1 Z2.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.121 Y91.15 E.00953
G1 X86.715 Y91.052 E.01283
G1 X85.51 Y91.008 E.03706
G1 X85.51 Y92.897 E.05804
G1 X86.469 Y92.886 E.02947
G2 X87.311 Y92.681 I-.349 J-3.274 E.02671
G1 X87.462 Y92.524 E.00667
G2 X87.551 Y92.078 I-1.167 J-.466 E.01405
G1 X87.51 Y91.587 E.01515
G1 X87.403 Y91.382 E.00712
M204 S10000
G1 X87.127 Y91.651 F42000
G1 F15000
M204 S6000
G1 X87.062 Y91.552 E.00363
G1 X86.741 Y91.434 E.01051
G1 X85.887 Y91.388 E.02628
G1 X85.887 Y92.515 E.03463
G1 X86.444 Y92.509 E.01711
G1 X86.872 Y92.429 E.01339
G1 X87.131 Y92.324 E.00859
G1 X87.175 Y92.046 E.00866
G1 X87.134 Y91.71 E.01038
M204 S10000
G1 X86.787 Y91.831 F42000
; LINE_WIDTH: 0.40421
G1 F15000
M204 S6000
G1 X86.256 Y91.761 E.01578
G1 X86.256 Y92.142 E.01122
G1 X86.694 Y92.099 E.01297
G1 X86.803 Y92.063 E.00338
G2 X86.794 Y91.891 I-.435 J-.063 E.00511
; CHANGE_LAYER
; Z_HEIGHT: 2.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15000
G1 X86.803 Y92.063 E-.07965
G1 X86.694 Y92.099 E-.05301
G1 X86.256 Y92.142 E-.20351
G1 X86.256 Y91.761 E-.17614
G1 X86.787 Y91.831 E-.24769
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 14/15
; update layer progress
M73 L14
M991 S0 P13 ;notify layer change
; OBJECT_ID: 110
M204 S10000
G17
G3 Z3 I1.178 J.306 P1  F42000
G1 X88.8 Y84.083 Z3
G1 Z2.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X86.291 Y88.394 E.16545
G1 X85.118 Y88.394 E.03892
G1 X85.118 Y84.083 E.14299
G1 X88.74 Y84.083 E.12017
; WIPE_START
G1 X87.752 Y85.822 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.601 Y85 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X88.044 Y89.23 E.15188
G3 X89.639 Y90.564 I-1.051 J2.878 E.06521
G3 X89.967 Y92.491 I-3.061 J1.513 E.0609
G3 X88.261 Y94.808 I-2.638 J-.156 E.0935
G3 X86.126 Y95.142 I-2.026 J-5.964 E.06674
G1 X83.125 Y95.142 E.09221
G1 X83.125 Y84.561 E.32513
G1 X84.726 Y84.561 E.04919
G1 X84.726 Y88.786 E.12984
G1 X86.517 Y88.786 E.05503
G1 X88.976 Y84.561 E.15023
G1 X92.077 Y84.561 E.09526
G1 X93.326 Y87.792 E.10646
G1 X97.111 Y87.792 E.1163
G1 X98.377 Y84.561 E.10663
G1 X100.051 Y84.561 E.05144
G1 X95.89 Y95.184 E.35058
G1 X94.61 Y95.184 E.03934
G1 X90.623 Y85.056 E.33447
; WIPE_START
M204 S6000
G1 X89.571 Y86.757 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X82.165 Y84.911 Z3.2 F42000
G1 X80.758 Y84.561 Z3.2
G1 Z2.8
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X80.758 Y95.142 E.32513
G1 X79.157 Y95.142 E.04919
G1 X79.157 Y84.561 E.32513
G1 X80.698 Y84.561 E.04735
; WIPE_START
M204 S6000
G1 X80.71 Y86.561 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.038 Y90.268 Z3.2 F42000
G1 X73.984 Y90.298 Z3.2
G1 Z2.8
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X71.419 Y95.142 E.16843
G1 X69.648 Y95.142 E.0544
G1 X73.175 Y88.603 E.22829
G1 X73.175 Y84.561 E.12421
G1 X74.789 Y84.561 E.0496
G1 X74.789 Y88.658 E.1259
G1 X78.324 Y95.142 E.22692
G1 X76.566 Y95.142 E.05403
G1 X74.012 Y90.351 E.16683
; WIPE_START
M204 S6000
G1 X73.06 Y92.109 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X72.783 Y88.073 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X72.783 Y88.504 E.01428
G1 X68.991 Y95.534 E.26496
G1 X71.655 Y95.534 E.08835
G1 X73.985 Y91.133 E.16518
G1 X76.331 Y95.534 E.16542
G1 X81.15 Y95.534 E.15988
G1 X81.15 Y84.083 E.37983
G1 X82.733 Y84.083 E.05249
G1 X82.733 Y95.534 E.37983
G1 X86.134 Y95.534 E.11282
G2 X88.404 Y95.173 I.107 J-6.654 E.07664
G2 X90.358 Y92.529 I-1.074 J-2.837 E.11528
G2 X89.984 Y90.377 I-3.778 J-.452 E.07347
G2 X88.604 Y89.06 I-2.859 J1.614 E.06421
M73 P89 R1
G1 X90.526 Y85.881 E.12322
G1 X94.343 Y95.576 E.34563
G1 X96.157 Y95.576 E.0602
G1 X100.339 Y84.901 E.38032
G1 X100.538 Y84.938 E.00671
G1 X100.538 Y95.534 E.35148
G1 X102.8 Y95.534 E.07505
G1 X107.197 Y88.793 E.26697
G1 X107.372 Y88.845 E.00604
G1 X107.369 Y95.534 E.22189
G1 X109.679 Y95.534 E.07662
G1 X109.679 Y84.083 E.37983
G1 X111.898 Y84.083 E.0736
G1 X111.898 Y95.917 E.39252
G1 X68.102 Y95.917 E1.45279
G1 X68.102 Y84.083 E.39252
G1 X72.783 Y84.083 E.15527
G1 X72.783 Y88.013 E.13036
; WIPE_START
G1 X72.783 Y88.504 E-.18639
G1 X72.066 Y89.832 E-.57361
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.064 Y85.112 Z3.2 F42000
G1 X78.765 Y84.561 Z3.2
G1 Z2.8
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X78.765 Y94.747 E.33791
G1 X78.581 Y94.794 E.0063
G1 X75.181 Y88.558 E.23562
G1 X75.181 Y84.083 E.14843
G1 X78.765 Y84.083 E.11889
G1 X78.765 Y84.501 E.01384
; WIPE_START
G1 X78.765 Y86.501 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X86.279 Y85.16 Z3.2 F42000
G1 X92.312 Y84.083 Z3.2
G1 Z2.8
G1 E.8 F1800
G1 F15476.087
M204 S6000
G1 X98.142 Y84.083 E.1934
G1 X96.844 Y87.4 E.11815
G1 X93.595 Y87.4 E.10776
G1 X92.334 Y84.139 E.11597
; WIPE_START
G1 X94.334 Y84.12 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.785 Y85.774 Z3.2 F42000
G1 X107.824 Y87.114 Z3.2
G1 Z2.8
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X102.588 Y95.142 E.29452
G1 X100.93 Y95.142 E.05095
G1 X100.93 Y84.561 E.32513
G1 X102.442 Y84.561 E.04646
G1 X102.442 Y90.548 E.18399
G3 X102.371 Y92.614 I-28.136 J.064 E.06352
G1 X107.616 Y84.561 E.29531
G1 X109.287 Y84.561 E.05136
G1 X109.287 Y95.142 E.32513
G1 X107.762 Y95.142 E.04687
G1 X107.764 Y88.513 E.20368
G3 X107.821 Y87.173 I52.091 J1.55 E.04121
; WIPE_START
M204 S6000
G1 X106.723 Y88.845 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.458 Y84.083 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X103.003 Y90.924 E.2708
G1 X102.827 Y90.87 E.00611
G1 X102.834 Y84.083 E.22512
G1 X107.398 Y84.083 E.15142
; WIPE_START
G1 X106.317 Y85.766 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X110.08 Y92.407 Z3.2 F42000
G1 X112.29 Y96.309 Z3.2
G1 Z2.8
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3.2 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z3.2
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z3.2 F4000
            G39.3 S1
            G0 Z3.2 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X110.071 Y95.524 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X111.506 Y95.524 E.04408
G1 X111.506 Y84.476 E.33949
G1 X110.071 Y84.476 E.04408
G1 X110.071 Y95.464 E.33765
M204 S10000
G1 X110.524 Y95.072 F42000
; LINE_WIDTH: 0.57172
G1 F11913.767
M204 S6000
G1 X111.053 Y95.072 E.02279
G1 X111.053 Y84.928 E.43707
G1 X110.524 Y84.928 E.02279
G1 X110.524 Y95.012 E.43448
; WIPE_START
G1 X110.524 Y93.012 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X105.346 Y94.403 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; LINE_WIDTH: 0.40139
G1 F15000
M204 S6000
G1 X105.856 Y94.403 E.0149
G1 X105.856 Y93.62 E.02286
G1 X105.379 Y94.352 E.02554
M204 S10000
G1 X104.667 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X106.224 Y94.77 E.04783
G1 X106.224 Y92.382 E.07337
G1 X104.7 Y94.72 E.08576
M204 S10000
G1 X103.971 Y95.147 F42000
G1 F15000
M204 S6000
G1 X106.6 Y95.147 E.0808
G1 X106.602 Y91.113 E.12395
G1 X104.003 Y95.097 E.14614
M204 S10000
G1 X103.275 Y95.524 F42000
G1 F15000
M204 S6000
G1 X106.977 Y95.524 E.11378
G1 X106.979 Y89.844 E.17453
G1 X103.307 Y95.474 E.20653
; WIPE_START
G1 X104.4 Y93.799 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X98.955 Y92.773 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; LINE_WIDTH: 0.53875
G1 F12705.968
M204 S6000
G1 X98.344 Y94.334 E.06772
G1 X98.955 Y94.334 E.0247
G1 X98.955 Y92.833 E.06063
M204 S10000
G1 X97.704 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X99.392 Y94.77 E.05185
G1 X99.392 Y90.462 E.13238
G1 X97.726 Y94.714 E.14032
M204 S10000
G1 X97.151 Y95.147 F42000
M73 P90 R1
G1 F15000
M204 S6000
G1 X99.769 Y95.147 E.08042
G1 X99.769 Y88.465 E.20531
G1 X97.173 Y95.092 E.21865
M204 S10000
G1 X96.599 Y95.524 F42000
G1 F15000
M204 S6000
G1 X100.146 Y95.524 E.10898
G1 X100.146 Y87.288 E.25307
G1 X99.847 Y87.232 E.00934
G1 X96.621 Y95.469 E.27181
; WIPE_START
G1 X97.35 Y93.606 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X91.793 Y93.39 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; LINE_WIDTH: 0.51728
G1 F13281.053
M204 S6000
G3 X91.468 Y94.345 I-3.696 J-.724 E.03908
G1 X92.168 Y94.345 E.02706
G1 X91.815 Y93.446 E.03733
M204 S10000
G1 X91.49 Y91.459 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X91.504 Y92.551 E.03357
G1 X91.344 Y93.468 E.02861
G1 X91.048 Y94.248 E.02563
G1 X90.724 Y94.77 E.01889
G1 X92.794 Y94.77 E.06359
G1 X91.512 Y91.515 E.10751
M204 S10000
G1 X90.319 Y90.173 F42000
G1 F15000
M204 S6000
G1 X90.598 Y90.834 E.02205
G1 X90.749 Y91.594 E.02379
G1 X90.749 Y92.549 E.02935
G1 X90.604 Y93.326 E.02431
G1 X90.349 Y93.965 E.02113
G1 X89.987 Y94.516 E.02024
G1 X89.52 Y94.981 E.02027
G1 X89.199 Y95.2 E.01191
G1 X89.261 Y95.524 E.01016
G1 X93.901 Y95.524 E.14257
G1 X90.452 Y86.762 E.28935
G1 X89.141 Y88.93 E.07786
G1 X89.424 Y89.124 E.01056
G1 X89.916 Y89.594 E.0209
G1 X90.285 Y90.124 E.01983
M204 S10000
G1 X90.683 Y89.923 F42000
; LINE_WIDTH: 0.54105
G1 F12647.3
M204 S6000
G1 X90.998 Y90.668 E.03285
; LINE_WIDTH: 0.51359
G1 F13385.175
G1 X91.038 Y90.953 E.01102
; LINE_WIDTH: 0.47615
G1 F14541.93
G1 X91.079 Y91.237 E.01014
; LINE_WIDTH: 0.420445
G1 F15000
G1 X91.119 Y91.522 E.00884
G1 X91.126 Y92.55 E.03163
G1 X90.974 Y93.397 E.02649
G1 X90.699 Y94.107 E.02341
G1 X90.301 Y94.725 E.02261
G1 X89.888 Y95.147 E.01818
G1 X93.347 Y95.147 E.10641
G1 X91.838 Y91.312 E.12679
; LINE_WIDTH: 0.439367
G1 X91.73 Y91.091 E.00795
; LINE_WIDTH: 0.47812
G1 F14476.104
G1 X91.622 Y90.87 E.00873
; LINE_WIDTH: 0.532789
G1 F12860.581
G1 X91.514 Y90.649 E.00983
G1 X91.2 Y89.855 E.03407
; LINE_WIDTH: 0.518757
G1 F13239.836
G1 X91.115 Y89.584 E.01101
; LINE_WIDTH: 0.47925
G1 F14438.612
G1 X91.029 Y89.313 E.0101
; LINE_WIDTH: 0.421404
G1 F15000
G1 X90.944 Y89.042 E.00876
G1 X90.38 Y87.609 E.04749
G1 X89.647 Y88.821 E.04368
G1 X90.177 Y89.322 E.02246
; LINE_WIDTH: 0.441624
G1 X90.333 Y89.507 E.00786
; LINE_WIDTH: 0.48489
G1 F14254.362
G1 X90.488 Y89.692 E.00872
; LINE_WIDTH: 0.528157
G1 F12983.355
G1 X90.644 Y89.877 E.00957
M204 S10000
G1 X90.784 Y89.577 F42000
; LINE_WIDTH: 0.35449
G1 F15000
M204 S6000
G1 X90.315 Y88.383 E.03257
G1 X90.087 Y88.76 E.01117
G1 X90.536 Y89.215 E.01623
G1 X90.75 Y89.527 E.00962
; WIPE_START
G1 X90.536 Y89.215 E-.14405
G1 X90.087 Y88.76 E-.24291
G1 X90.315 Y88.383 E-.16715
G1 X90.513 Y88.887 E-.2059
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.621 Y85.903 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; LINE_WIDTH: 0.366415
G1 F15000
M204 S6000
G1 X95.823 Y85.903 E.03168
G1 X95.949 Y85.58 E.00916
G1 X94.496 Y85.58 E.03832
G1 X94.599 Y85.848 E.00756
M204 S10000
G1 X94.381 Y86.254 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X96.062 Y86.254 E.05165
G1 X96.463 Y85.23 E.03379
G1 X93.985 Y85.23 E.07614
G1 X94.359 Y86.198 E.03189
M204 S10000
G1 X94.122 Y86.631 F42000
G1 F15000
M204 S6000
G1 X96.319 Y86.631 E.06749
G1 X97.015 Y84.853 E.05868
G1 X93.435 Y84.853 E.11002
G1 X94.101 Y86.575 E.05674
M204 S10000
G1 X93.864 Y87.008 F42000
G1 F15000
M204 S6000
G1 X96.576 Y87.008 E.08334
G1 X97.568 Y84.476 E.08356
G1 X92.884 Y84.476 E.14391
G1 X93.842 Y86.952 E.08158
; WIPE_START
G1 X93.121 Y85.087 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X92.119 Y84.126 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X89.003 Y84.126 E.12115
; WIPE_START
G1 X91.003 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X86.269 Y86.144 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42967
G1 F15000
M204 S6000
G1 X86.799 Y85.235 E.03318
G1 X86.269 Y85.235 E.01669
G1 X86.269 Y86.084 E.02679
M204 S10000
G1 X85.887 Y87.56 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.463 Y84.853 E.09625
G1 X85.887 Y84.853 E.04842
G1 X85.887 Y87.5 E.08134
M204 S10000
G1 X86.066 Y88.002 F42000
G1 F15000
M204 S6000
G1 X88.119 Y84.476 E.12538
G1 X85.51 Y84.476 E.08016
G1 X85.51 Y88.002 E.10836
G1 X86.006 Y88.002 E.01524
; WIPE_START
G1 X85.51 Y88.002 E-.18845
G1 X85.51 Y86.498 E-.57155
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.922 Y84.126 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X82.929 Y84.126 E.07748
M204 S10000
G1 X82.341 Y84.875 F42000
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X82.341 Y84.476 E.01227
G1 X81.542 Y84.476 E.02453
G1 X81.542 Y95.524 E.33949
G1 X82.341 Y95.524 E.02453
G1 X82.341 Y84.935 E.32539
M204 S10000
G1 X81.942 Y95.125 F42000
; LINE_WIDTH: 0.46422
G1 F14953.716
M204 S6000
G1 X81.942 Y84.935 E.34985
; WIPE_START
G1 X81.942 Y86.935 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X80.954 Y84.126 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X78.961 Y84.126 E.07748
; WIPE_START
G1 X80.954 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.985 Y84.126 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
G1 F13203.395
M204 S6000
G1 X72.979 Y84.126 E.078
; WIPE_START
G1 X74.979 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X70.442 Y87.913 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.54588
G1 F12525.848
M204 S6000
G1 X70.442 Y86.484 E.05857
M204 S10000
G1 X70.882 Y88.024 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X70.882 Y85.984 E.06269
G1 X70.002 Y85.984 E.02704
G1 X70.002 Y89.656 E.11283
G1 X70.854 Y88.077 E.05512
M204 S10000
G1 X71.26 Y88.119 F42000
G1 F15000
M204 S6000
G1 X71.26 Y85.607 E.0772
G1 X69.625 Y85.607 E.05021
G1 X69.625 Y91.149 E.1703
G1 X71.231 Y88.172 E.10394
M204 S10000
G1 X71.637 Y88.214 F42000
G1 F15000
M204 S6000
G1 X71.637 Y85.23 E.09171
G1 X69.248 Y85.23 E.07338
G1 X69.248 Y92.643 E.22778
G1 X71.608 Y88.267 E.15275
M204 S10000
G1 X72.014 Y88.31 F42000
G1 F15000
M204 S6000
G1 X72.014 Y84.853 E.10622
G1 X68.871 Y84.853 E.09656
G1 X68.871 Y94.136 E.28525
G1 X71.985 Y88.362 E.20157
M204 S10000
G1 X72.391 Y88.405 F42000
G1 F15000
M204 S6000
G1 X72.391 Y84.476 E.12073
G1 X68.494 Y84.476 E.11973
G1 X68.494 Y95.524 E.33949
G1 X68.561 Y95.506 E.00213
G1 X72.362 Y88.458 E.24605
; WIPE_START
G1 X71.413 Y90.218 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.202 Y88.998 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; LINE_WIDTH: 0.5002
G1 F13777.117
M204 S6000
G1 X77.202 Y85.647 E.12488
G1 X76.745 Y85.647 E.01704
G1 X76.745 Y88.159 E.09363
G1 X77.173 Y88.946 E.03336
M204 S10000
G1 X77.619 Y90.635 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X77.619 Y85.23 E.16608
G1 X76.327 Y85.23 E.03969
G1 X76.327 Y88.266 E.09329
G1 X77.59 Y90.582 E.08106
M204 S10000
G1 X77.996 Y92.114 F42000
G1 F15000
M204 S6000
G1 X77.996 Y84.853 E.22312
G1 X75.95 Y84.853 E.06286
G1 X75.95 Y88.362 E.10783
G1 X77.967 Y92.061 E.12947
M204 S10000
G1 X78.373 Y93.593 F42000
G1 F15000
M204 S6000
G1 X78.373 Y84.476 E.28016
G1 X75.573 Y84.476 E.08603
G1 X75.573 Y88.458 E.12237
G1 X78.344 Y93.541 E.17788
; WIPE_START
G1 X77.387 Y91.785 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.013 Y94.347 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; LINE_WIDTH: 0.42844
G1 F15000
M204 S6000
G1 X73.941 Y94.389 E.00262
G1 X74.003 Y94.425 E.00225
M204 S10000
G1 X74.625 Y94.77 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X73.988 Y93.576 E.04157
G1 X73.356 Y94.77 E.04151
G1 X74.565 Y94.77 E.03714
M204 S10000
G1 X75.253 Y95.147 F42000
G1 F15000
M204 S6000
G1 X73.987 Y92.773 E.08269
G1 X72.73 Y95.147 E.08257
G1 X75.193 Y95.147 E.07569
M204 S10000
G1 X75.881 Y95.524 F42000
G1 F15000
M204 S6000
G1 X73.986 Y91.969 E.1238
M73 P91 R1
G1 X72.103 Y95.524 E.12362
G1 X75.821 Y95.524 E.11424
; WIPE_START
G1 X73.821 Y95.524 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X81.453 Y95.617 Z3.2 F42000
G1 X87.238 Y95.688 Z3.2
G1 Z2.8
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.116851
G1 F15000
M204 S6000
G1 X87.565 Y95.666 E.00198
; LINE_WIDTH: 0.15696
G1 X87.744 Y95.646 E.00167
; LINE_WIDTH: 0.197236
G1 X87.917 Y95.626 E.0022
; LINE_WIDTH: 0.236999
G1 X88.091 Y95.606 E.00276
; LINE_WIDTH: 0.258329
G1 X88.101 Y95.605 E.00018
; LINE_WIDTH: 0.283487
G1 X88.246 Y95.581 E.00288
; LINE_WIDTH: 0.330933
G1 X88.391 Y95.557 E.00345
; LINE_WIDTH: 0.378378
G1 X88.536 Y95.533 E.00401
; LINE_WIDTH: 0.40542
G1 X88.852 Y95.474 E.00951
; WIPE_START
G1 X88.536 Y95.533 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.64 Y90.951 Z3.2 F42000
G1 X100.069 Y86.875 Z3.2
G1 Z2.8
G1 E.8 F1800
; LINE_WIDTH: 0.465697
G1 F14901.482
M204 S6000
G1 X100.099 Y86.714 E.00564
; LINE_WIDTH: 0.416527
G1 F15000
G1 X100.13 Y86.553 E.00499
; LINE_WIDTH: 0.367357
G1 X100.16 Y86.392 E.00433
; LINE_WIDTH: 0.318186
G1 X100.191 Y86.231 E.00367
; LINE_WIDTH: 0.269016
M73 P91 R0
G1 X100.221 Y86.07 E.00302
; LINE_WIDTH: 0.219846
G1 X100.251 Y85.909 E.00236
; LINE_WIDTH: 0.170676
G1 X100.282 Y85.748 E.00171
; LINE_WIDTH: 0.121505
G1 X100.312 Y85.587 E.00105
M204 S10000
G1 X100.475 Y84.727 F42000
; LINE_WIDTH: 0.461657
G1 F15000
M204 S6000
G2 X100.536 Y84.315 I-1.479 J-.431 E.01424
; LINE_WIDTH: 0.499786
G1 F13789.601
G1 X100.536 Y84.266 E.00184
; LINE_WIDTH: 0.540684
G1 F12656.617
G1 X100.536 Y84.216 E.002
; LINE_WIDTH: 0.581581
G1 F11695.674
G1 X100.536 Y84.167 E.00217
; LINE_WIDTH: 0.58155
G1 F11696.341
G1 X100.635 Y84.147 E.00443
; LINE_WIDTH: 0.54057
G1 F12659.499
G1 X100.734 Y84.126 E.0041
; LINE_WIDTH: 0.52007
G1 F13203.395
G1 X102.638 Y84.126 E.07403
M204 S10000
G1 X100.536 Y84.167 F42000
; LINE_WIDTH: 0.581537
G1 F11696.623
M204 S6000
G1 X100.437 Y84.147 E.00443
; LINE_WIDTH: 0.521064
G1 F13175.971
G1 X100.338 Y84.126 E.00393
G1 X98.336 Y84.126 E.07799
; WIPE_START
G1 X100.336 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X104.495 Y85.647 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.62596
G1 F10805.433
M204 S6000
G2 X104.501 Y85.762 I-.033 J.06 E.01377
M204 S10000
G1 X103.977 Y87.329 F42000
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X105.344 Y85.23 E.07698
G1 X103.979 Y85.23 E.04195
G1 X103.977 Y87.269 E.06266
M204 S10000
G1 X103.598 Y88.601 F42000
G1 F15000
M204 S6000
G1 X106.04 Y84.853 E.13744
G1 X103.602 Y84.853 E.07489
G1 X103.599 Y88.541 E.11332
M204 S10000
G1 X103.22 Y89.873 F42000
G1 F15000
M204 S6000
G1 X106.735 Y84.476 E.1979
G1 X103.225 Y84.476 E.10784
G1 X103.22 Y89.813 E.16399
; WIPE_START
G1 X103.222 Y87.813 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X107.665 Y84.126 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X109.483 Y84.126 E.0707
; WIPE_START
G1 X107.665 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.152 Y88.106 Z3.2 F42000
G1 X95.249 Y91.714 Z3.2
G1 Z2.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X94.473 Y89.667 E.07262
G1 X96.018 Y89.667 E.05126
G1 X95.27 Y91.658 E.07055
; WIPE_START
G1 X94.527 Y89.801 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.244 Y92.908 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X94.993 Y92.144 E.02472
G1 X93.905 Y89.275 E.09429
G1 X96.584 Y89.275 E.08234
G1 X96.336 Y89.936 E.02169
G2 X95.272 Y92.815 I60.939 J24.154 E.09432
G1 X95.261 Y92.851 E.00115
; WIPE_START
M204 S6000
G1 X94.993 Y92.144 E-.28731
G1 X94.552 Y90.981 E-.47269
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X95.007 Y90.036 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.37362
G1 F15000
M204 S6000
G1 X95.248 Y90.67 E.01826
G1 X95.486 Y90.036 E.01824
G1 X95.067 Y90.036 E.01127
; WIPE_START
G1 X95.486 Y90.036 E-.17934
G1 X95.248 Y90.67 E-.29016
G1 X95.007 Y90.036 E-.2905
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.758 Y92.424 Z3.2 F42000
G1 X85.118 Y93.293 Z3.2
G1 Z2.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F15476.087
M204 S6000
G1 X85.118 Y90.612 E.08894
G3 X86.262 Y90.619 I.503 J12.561 E.03797
G3 X87.483 Y90.895 I.069 J2.532 E.04196
G3 X87.945 Y91.809 I-.681 J.918 E.03525
G3 X87.77 Y92.786 I-1.582 J.221 E.03348
G3 X87.133 Y93.176 I-.812 J-.61 E.02538
G3 X86.042 Y93.293 I-1.071 J-4.84 E.03648
G1 X85.178 Y93.293 E.02866
M204 S250
G1 X84.726 Y93.686 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X84.726 Y90.22 E.10648
G1 X86.28 Y90.227 E.04775
G3 X87.7 Y90.567 I.085 J2.776 E.0454
G3 X88.336 Y91.778 I-.854 J1.221 E.04366
G3 X88.097 Y93.003 I-1.959 J.254 E.03902
G3 X87.235 Y93.556 I-1.137 J-.826 E.03222
G3 X86.049 Y93.686 I-1.172 J-5.22 E.03674
G1 X84.786 Y93.686 E.03881
; WIPE_START
M204 S6000
G1 X84.751 Y91.686 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.485 Y91.513 Z3.2 F42000
G1 Z2.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.41999
G1 F15000
M204 S6000
G1 X87.316 Y91.264 E.00925
G1 X87.024 Y91.122 E.00997
G1 X86.52 Y91.036 E.01573
G1 X85.51 Y91.007 E.03105
G1 X85.51 Y92.897 E.05808
G1 X86.469 Y92.886 E.02947
G2 X87.315 Y92.67 I-.119 J-2.236 E.027
G1 X87.408 Y92.602 E.00356
G1 X87.53 Y92.317 E.00951
G2 X87.494 Y91.572 I-1.96 J-.277 E.02305
M204 S10000
G1 X87.131 Y91.663 F42000
G1 F15000
M204 S6000
G1 X86.997 Y91.515 E.00612
G1 X86.69 Y91.43 E.0098
G1 X85.887 Y91.386 E.02471
G1 X85.887 Y92.515 E.03471
G1 X86.444 Y92.509 E.01711
G1 X86.997 Y92.398 E.01733
G1 X87.107 Y92.347 E.00374
G2 X87.14 Y91.722 I-1.123 J-.372 E.01945
M204 S10000
G1 X86.789 Y91.83 F42000
; LINE_WIDTH: 0.40286
G1 F15000
M204 S6000
G1 X86.255 Y91.76 E.01579
G1 X86.255 Y92.143 E.01122
G1 X86.689 Y92.105 E.01277
G1 X86.795 Y92.074 E.00323
G2 X86.799 Y91.889 I-.425 J-.103 E.00545
; CHANGE_LAYER
; Z_HEIGHT: 3
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F15000
G1 X86.795 Y92.074 E-.08491
G1 X86.689 Y92.105 E-.05074
G1 X86.255 Y92.143 E-.20041
G1 X86.255 Y91.76 E-.17608
G1 X86.789 Y91.83 E-.24786
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 15/15
; update layer progress
M73 L15
M991 S0 P14 ;notify layer change
M106 S198.9
; OBJECT_ID: 110
M204 S10000
G17
G3 Z3.2 I1.063 J.593 P1  F42000
G1 X90.601 Y85 Z3.2
G1 Z3
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X88.044 Y89.23 E.15188
G3 X89.639 Y90.564 I-1.051 J2.878 E.06521
G3 X89.967 Y92.491 I-3.061 J1.513 E.06091
G3 X88.261 Y94.808 I-2.638 J-.156 E.0935
G3 X86.126 Y95.142 I-2.026 J-5.964 E.06674
G1 X83.125 Y95.142 E.09221
G1 X83.125 Y84.561 E.32513
G1 X84.726 Y84.561 E.04919
G1 X84.726 Y88.786 E.12984
G1 X86.517 Y88.786 E.05503
G1 X88.976 Y84.561 E.15023
G1 X92.077 Y84.561 E.09526
G1 X93.326 Y87.792 E.10646
G1 X97.111 Y87.792 E.1163
G1 X98.377 Y84.561 E.10663
G1 X100.051 Y84.561 E.05144
G1 X95.89 Y95.184 E.35058
G1 X94.61 Y95.184 E.03934
G1 X90.623 Y85.056 E.33447
; WIPE_START
M204 S6000
G1 X89.571 Y86.757 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X82.165 Y84.911 Z3.4 F42000
G1 X80.758 Y84.561 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X80.758 Y95.142 E.32513
G1 X79.157 Y95.142 E.04919
G1 X79.157 Y84.561 E.32513
G1 X80.698 Y84.561 E.04735
; WIPE_START
M204 S6000
G1 X80.71 Y86.561 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X74.038 Y90.268 Z3.4 F42000
G1 X73.984 Y90.298 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X71.419 Y95.142 E.16843
G1 X69.648 Y95.142 E.0544
G1 X73.175 Y88.603 E.22829
G1 X73.175 Y84.561 E.12421
G1 X74.789 Y84.561 E.0496
G1 X74.789 Y88.658 E.1259
G1 X78.324 Y95.142 E.22692
G1 X76.566 Y95.142 E.05403
G1 X74.012 Y90.351 E.16683
; WIPE_START
M204 S6000
G1 X73.06 Y92.109 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X80.615 Y91.024 Z3.4 F42000
G1 X107.824 Y87.114 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X102.588 Y95.142 E.29452
G1 X100.93 Y95.142 E.05095
G1 X100.93 Y84.561 E.32513
G1 X102.442 Y84.561 E.04646
G1 X102.442 Y90.548 E.18399
G3 X102.371 Y92.614 I-28.127 J.064 E.06352
G1 X107.616 Y84.561 E.29531
G1 X109.287 Y84.561 E.05136
G1 X109.287 Y95.142 E.32513
G1 X107.762 Y95.142 E.04687
G1 X107.764 Y88.513 E.20368
G3 X107.821 Y87.173 I52.091 J1.55 E.04121
; WIPE_START
M204 S6000
G1 X106.723 Y88.845 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X111.287 Y94.963 Z3.4 F42000
G1 X112.29 Y96.309 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S5000
G1 X67.71 Y96.309 E1.36982
G1 X67.71 Y83.691 E.38769
G1 X112.29 Y83.691 E1.36982
G1 X112.29 Y96.249 E.38585
; WIPE_START
M204 S6000
G1 X110.29 Y96.251 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3.4 I1.217 J0 P1  F42000
;===================== date: 20250206 =====================

; don't support timelapse gcode in spiral_mode and by object sequence for I3 structure printer
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
G92 E0
G1 Z3.4
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos
M400
M1004 S5 P1  ; external shutter
M400 P300
M971 S11 C11 O0
G92 E0
G1 X0 F18000
M623

; SKIPTYPE: head_wrap_detect
M622.1 S1
M1002 judge_flag g39_3rd_layer_detect_flag
M622 J1
    ; enable nozzle clog detect at 3rd layer
    


    M622.1 S1
    M1002 judge_flag g39_detection_flag
    M622 J1
      
        M622.1 S0
        M1002 judge_flag g39_mass_exceed_flag
        M622 J1
        
            G392 S0
            M400
            G90
            M83
            M204 S5000
            G0 Z3.4 F4000
            G39.3 S1
            G0 Z3.4 F4000
            G392 S0
          
        M623
    
    M623
M623
; SKIPPABLE_END




G1 X109.483 Y84.126 F42000
G1 Z3
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X107.665 Y84.126 E.0707
M204 S10000
G1 X107.095 Y83.899 F42000
; FEATURE: Top surface
; LINE_WIDTH: 0.42
G1 F12000
M204 S2000
G1 X107.457 Y84.261 E.01573
G1 X107.311 Y84.648
G1 X106.562 Y83.899 E.03255
G1 X106.029 Y83.899
M73 P92 R0
G1 X107.101 Y84.971 E.04658
G1 X106.891 Y85.294
G1 X105.496 Y83.899 E.06062
G1 X104.962 Y83.899
G1 X106.68 Y85.617 E.07465
G1 X106.47 Y85.94
G1 X104.429 Y83.899 E.08868
G1 X103.896 Y83.899
G1 X106.26 Y86.263 E.10272
G1 X106.049 Y86.585
G1 X103.363 Y83.899 E.11675
G1 X102.845 Y83.914
G1 X105.839 Y86.908 E.1301
G1 X105.629 Y87.231
G1 X102.845 Y84.448 E.12096
G1 X102.649 Y84.785
G1 X105.418 Y87.554 E.12034
G1 X105.208 Y87.877
G1 X102.649 Y85.318 E.1112
G1 X102.649 Y85.852
G1 X104.998 Y88.2 E.10206
G1 X104.787 Y88.523
G1 X102.649 Y86.385 E.09292
G1 X102.649 Y86.918
G1 X104.577 Y88.846 E.08378
G1 X104.367 Y89.169
G1 X102.649 Y87.451 E.07464
G1 X102.649 Y87.985
G1 X104.156 Y89.492 E.0655
G1 X103.946 Y89.815
G1 X102.649 Y88.518 E.05636
G1 X102.649 Y89.051
G1 X103.736 Y90.138 E.04722
G1 X103.525 Y90.461
G1 X102.649 Y89.584 E.03808
G1 X102.649 Y90.118
G1 X103.315 Y90.784 E.02894
G1 X103.105 Y91.107
G1 X102.647 Y90.649 E.01989
M204 S10000
G1 X103.046 Y91.194 F42000
; FEATURE: Gap infill
; LINE_WIDTH: 0.0947693
G1 F15000
M204 S6000
G1 X102.992 Y91.261 E.00036
; LINE_WIDTH: 0.123193
G1 X102.802 Y91.342 E.00135
; LINE_WIDTH: 0.166844
G1 X102.612 Y91.423 E.00209
; WIPE_START
G1 X102.802 Y91.342 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X102.638 Y84.126 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X100.734 Y84.126 E.07403
; LINE_WIDTH: 0.54057
G1 F12659.499
G1 X100.635 Y84.147 E.0041
; LINE_WIDTH: 0.58155
G1 F11696.341
G1 X100.536 Y84.167 E.00443
; LINE_WIDTH: 0.581581
G1 F11695.674
G1 X100.536 Y84.216 E.00217
; LINE_WIDTH: 0.540684
G1 F12656.617
G1 X100.536 Y84.266 E.002
; LINE_WIDTH: 0.499786
G1 F13789.601
G1 X100.536 Y84.315 E.00184
; LINE_WIDTH: 0.461657
G1 F15000
G3 X100.475 Y84.727 I-1.54 J-.019 E.01424
M204 S10000
G1 X100.536 Y84.167 F42000
; LINE_WIDTH: 0.581537
G1 F11696.623
M204 S6000
G1 X100.437 Y84.147 E.00443
; LINE_WIDTH: 0.521064
G1 F13175.971
G1 X100.338 Y84.126 E.00393
G1 X98.336 Y84.126 E.07799
M204 S10000
G1 X97.497 Y83.899 F42000
; FEATURE: Top surface
; LINE_WIDTH: 0.42
G1 F12000
M204 S2000
G1 X98.129 Y84.531 E.02748
G1 X98.005 Y84.94
G1 X96.964 Y83.899 E.04527
G1 X96.43 Y83.899
G1 X97.855 Y85.324 E.06192
G1 X97.705 Y85.707
G1 X95.897 Y83.899 E.07857
G1 X95.364 Y83.899
G1 X97.555 Y86.09 E.09522
G1 X97.405 Y86.473
G1 X94.831 Y83.899 E.11187
G1 X94.297 Y83.899
G1 X97.255 Y86.856 E.12852
G1 X97.105 Y87.24
G1 X93.764 Y83.899 E.14518
G1 X93.231 Y83.899
G1 X96.917 Y87.585 E.16017
G1 X96.383 Y87.585
G1 X92.697 Y83.899 E.16017
G1 X92.326 Y84.06
G1 X95.85 Y87.585 E.15314
G1 X95.317 Y87.585
G1 X92.326 Y84.594 E.12997
G1 X92.639 Y85.44
G1 X94.784 Y87.585 E.09319
G1 X94.25 Y87.585
G1 X92.975 Y86.31 E.0554
; WIPE_START
M204 S6000
G1 X94.25 Y87.585 E-.6851
G1 X94.447 Y87.585 E-.0749
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X92.119 Y84.126 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X89.003 Y84.126 E.12115
M204 S10000
G1 X88.431 Y83.899 F42000
; FEATURE: Top surface
; LINE_WIDTH: 0.42
G1 F12000
M204 S2000
G1 X88.795 Y84.263 E.01581
G1 X88.671 Y84.672
G1 X87.898 Y83.899 E.03361
G1 X87.365 Y83.899
G1 X88.475 Y85.009 E.04825
G1 X88.279 Y85.346
G1 X86.832 Y83.899 E.0629
G1 X86.298 Y83.899
G1 X88.083 Y85.683 E.07755
G1 X87.887 Y86.02
G1 X85.765 Y83.899 E.09219
G1 X85.232 Y83.899
G1 X87.69 Y86.357 E.10684
G1 X87.494 Y86.694
G1 X85.129 Y84.329 E.10278
G1 X84.933 Y84.667
G1 X87.298 Y87.032 E.10277
G1 X87.102 Y87.369
G1 X84.933 Y85.2 E.09424
G1 X84.933 Y85.733
G1 X86.906 Y87.706 E.08572
G1 X86.709 Y88.043
G1 X84.933 Y86.266 E.07719
G1 X84.933 Y86.8
G1 X86.513 Y88.38 E.06867
G1 X86.179 Y88.579
G1 X84.933 Y87.333 E.05414
G1 X84.933 Y87.866
G1 X85.646 Y88.579 E.03097
; WIPE_START
M204 S6000
G1 X84.933 Y87.866 E-.38298
G1 X84.933 Y87.333 E-.20264
G1 X85.258 Y87.657 E-.17439
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X84.922 Y84.126 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.52007
G1 F13203.395
M204 S6000
G1 X82.929 Y84.126 E.07748
; WIPE_START
G1 X84.922 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X80.954 Y84.126 Z3.4 F42000
G1 Z3
G1 E.8 F1800
G1 F13203.395
M204 S6000
G1 X78.961 Y84.126 E.07748
; WIPE_START
G1 X80.954 Y84.126 E-.76
; WIPE_END
M73 P93 R0
G1 E-.04 F1800
M204 S10000
G1 X74.985 Y84.126 Z3.4 F42000
G1 Z3
G1 E.8 F1800
G1 F13203.395
M204 S6000
G1 X72.979 Y84.126 E.078
; WIPE_START
G1 X74.979 Y84.126 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X71.9 Y83.899 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; FEATURE: Top surface
; LINE_WIDTH: 0.42
G1 F12000
M204 S2000
G1 X72.967 Y84.966 E.04637
G1 X72.967 Y85.499
G1 X71.367 Y83.899 E.06954
G1 X70.834 Y83.899
G1 X72.967 Y86.032 E.09271
G1 X72.967 Y86.566
G1 X70.301 Y83.899 E.11589
G1 X69.767 Y83.899
G1 X72.967 Y87.099 E.13906
G1 X72.967 Y87.632
G1 X69.234 Y83.899 E.16223
G1 X68.701 Y83.899
G1 X72.967 Y88.165 E.1854
G1 X72.916 Y88.647
G1 X68.168 Y83.899 E.20632
G1 X67.917 Y84.182
G1 X72.729 Y88.993 E.20908
G1 X72.542 Y89.34
G1 X67.917 Y84.715 E.20096
G1 X67.917 Y85.248
G1 X72.355 Y89.686 E.19284
G1 X72.168 Y90.032
G1 X67.917 Y85.782 E.18472
G1 X67.917 Y86.315
G1 X71.981 Y90.379 E.1766
G1 X71.795 Y90.725
G1 X67.917 Y86.848 E.16848
G1 X67.917 Y87.381
G1 X71.608 Y91.072 E.16036
G1 X71.421 Y91.418
G1 X67.917 Y87.915 E.15224
G1 X67.917 Y88.448
G1 X71.234 Y91.765 E.14413
G1 X71.047 Y92.111
G1 X67.917 Y88.981 E.13601
G1 X67.917 Y89.514
G1 X70.86 Y92.457 E.12789
G1 X70.674 Y92.804
G1 X67.917 Y90.048 E.11977
G1 X67.917 Y90.581
G1 X70.487 Y93.15 E.11165
G1 X70.3 Y93.497
G1 X67.917 Y91.114 E.10353
G1 X67.917 Y91.647
G1 X70.113 Y93.843 E.09541
G1 X69.926 Y94.189
G1 X67.917 Y92.181 E.08729
G1 X67.917 Y92.714
G1 X69.739 Y94.536 E.07917
G1 X69.553 Y94.882
G1 X67.917 Y93.247 E.07105
G1 X67.917 Y93.78
G1 X69.366 Y95.229 E.06294
; WIPE_START
M204 S6000
G1 X67.951 Y93.815 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X73.785 Y91.116 Z3.4 F42000
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X74.641 Y91.972 E.03721
; WIPE_START
M204 S6000
G1 X73.785 Y91.116 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X75.25 Y93.114 Z3.4 F42000
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X73.6 Y91.465 E.07168
G1 X73.416 Y91.813
G1 X75.859 Y94.256 E.10616
; WIPE_START
M204 S6000
G1 X74.445 Y92.842 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.9 Y86.036 Z3.4 F42000
G1 X78.754 Y84.353 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X78.3 Y83.899 E.01975
G1 X77.766 Y83.899
G1 X78.95 Y85.082 E.05144
G1 X78.95 Y85.616
G1 X77.233 Y83.899 E.07461
G1 X76.7 Y83.899
G1 X78.95 Y86.149 E.09778
G1 X78.95 Y86.682
G1 X76.166 Y83.899 E.12095
G1 X75.633 Y83.899
G1 X78.95 Y87.215 E.14413
G1 X78.95 Y87.749
G1 X75.192 Y83.991 E.16328
G1 X75.192 Y84.524
G1 X78.95 Y88.282 E.16328
G1 X78.95 Y88.815
G1 X74.996 Y84.862 E.1718
G1 X74.996 Y85.395
G1 X78.95 Y89.348 E.1718
G1 X78.95 Y89.882
G1 X74.996 Y85.928 E.1718
G1 X74.996 Y86.462
G1 X78.95 Y90.415 E.1718
G1 X78.95 Y90.948
G1 X74.996 Y86.995 E.1718
G1 X74.996 Y87.528
G1 X78.95 Y91.482 E.1718
G1 X78.95 Y92.015
G1 X74.996 Y88.061 E.1718
G1 X74.996 Y88.595
G1 X78.95 Y92.548 E.1718
G1 X78.95 Y93.081
G1 X75.623 Y89.755 E.14456
; WIPE_START
M204 S6000
G1 X77.037 Y91.169 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X76.263 Y90.927 Z3.4 F42000
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X78.95 Y93.615 E.11678
G1 X78.95 Y94.148
G1 X76.902 Y92.1 E.089
; WIPE_START
M204 S6000
G1 X78.316 Y93.514 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.541 Y93.272 Z3.4 F42000
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X78.95 Y94.681 E.06121
G1 X78.95 Y95.214
G1 X78.181 Y94.445 E.03343
; WIPE_START
M204 S6000
G1 X78.95 Y95.214 E-.41345
G1 X78.95 Y94.681 E-.20264
G1 X78.682 Y94.413 E-.14391
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X81.584 Y87.354 Z3.4 F42000
G1 X82.722 Y84.588 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X82.032 Y83.899 E.02995
G1 X81.499 Y83.899
G1 X82.917 Y85.317 E.06164
G1 X82.917 Y85.85
G1 X81.162 Y84.094 E.0763
G1 X81.127 Y84.594
G1 X82.917 Y86.384 E.07779
G1 X82.917 Y86.917
G1 X80.966 Y84.965 E.08482
G1 X80.966 Y85.498
G1 X82.917 Y87.45 E.08482
G1 X82.917 Y87.983
G1 X80.966 Y86.032 E.08482
G1 X80.966 Y86.565
G1 X82.917 Y88.517 E.08482
G1 X82.917 Y89.05
G1 X80.966 Y87.098 E.08482
G1 X80.966 Y87.631
G1 X82.917 Y89.583 E.08482
M73 P94 R0
G1 X82.917 Y90.116
G1 X80.966 Y88.165 E.08482
G1 X80.966 Y88.698
G1 X82.917 Y90.65 E.08482
G1 X82.917 Y91.183
G1 X80.966 Y89.231 E.08482
G1 X80.966 Y89.764
G1 X82.917 Y91.716 E.08482
G1 X82.917 Y92.25
G1 X80.966 Y90.298 E.08482
G1 X80.966 Y90.831
G1 X82.917 Y92.783 E.08482
G1 X82.917 Y93.316
G1 X80.966 Y91.364 E.08482
G1 X80.966 Y91.897
G1 X82.917 Y93.849 E.08482
G1 X82.917 Y94.383
G1 X80.966 Y92.431 E.08482
G1 X80.966 Y92.964
G1 X82.917 Y94.916 E.08482
; WIPE_START
M204 S6000
G1 X81.503 Y93.502 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.597 Y88.906 Z3.4 F42000
G1 X90.927 Y86.394 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X90.349 Y85.817 E.02509
G1 X90.148 Y86.149
G1 X91.273 Y87.273 E.04886
G1 X91.619 Y88.153
G1 X89.947 Y86.481 E.07264
G1 X89.746 Y86.814
G1 X91.965 Y89.032 E.09641
G1 X92.311 Y89.912
G1 X89.546 Y87.146 E.12018
G1 X89.345 Y87.478
G1 X92.657 Y90.791 E.14396
G1 X93.004 Y91.671
G1 X89.144 Y87.811 E.16773
G1 X88.943 Y88.143
G1 X93.35 Y92.55 E.1915
G1 X93.696 Y93.429
G1 X88.742 Y88.475 E.21528
G1 X88.541 Y88.808
G1 X94.042 Y94.309 E.23905
G1 X94.388 Y95.188
G1 X89.959 Y90.759 E.19246
; WIPE_START
M204 S6000
G1 X91.374 Y92.173 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X97.255 Y87.308 Z3.4 F42000
G1 X100.129 Y84.931 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X100.722 Y85.525 E.0258
G1 X100.722 Y86.058
G1 X99.979 Y85.314 E.03232
G1 X99.828 Y85.697
G1 X100.722 Y86.591 E.03885
G1 X100.722 Y87.124
G1 X99.678 Y86.08 E.04537
G1 X99.528 Y86.464
G1 X100.722 Y87.658 E.05189
G1 X100.722 Y88.191
G1 X99.378 Y86.847 E.05841
G1 X99.228 Y87.23
G1 X100.722 Y88.724 E.06493
G1 X100.722 Y89.257
G1 X99.078 Y87.613 E.07145
G1 X98.928 Y87.996
G1 X100.722 Y89.791 E.07798
G1 X100.722 Y90.324
G1 X98.778 Y88.379 E.0845
G1 X98.628 Y88.763
G1 X100.722 Y90.857 E.09102
G1 X100.722 Y91.39
G1 X98.478 Y89.146 E.09754
G1 X98.328 Y89.529
G1 X100.722 Y91.924 E.10406
G1 X100.722 Y92.457
G1 X98.178 Y89.912 E.11058
G1 X98.028 Y90.295
G1 X100.722 Y92.99 E.11711
G1 X100.722 Y93.523
G1 X97.877 Y90.679 E.12363
G1 X97.727 Y91.062
G1 X100.722 Y94.057 E.13015
G1 X100.722 Y94.59
G1 X97.577 Y91.445 E.13667
G1 X97.427 Y91.828
G1 X100.722 Y95.123 E.14319
; WIPE_START
M204 S6000
G1 X99.308 Y93.709 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X105.705 Y89.546 Z3.4 F42000
G1 X107.061 Y88.664 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X107.556 Y89.159 E.02153
G1 X107.556 Y89.692
G1 X106.85 Y88.986 E.03067
G1 X106.64 Y89.309
G1 X107.556 Y90.225 E.03981
G1 X107.556 Y90.758
G1 X106.429 Y89.632 E.04895
G1 X106.219 Y89.955
G1 X107.556 Y91.291 E.05809
G1 X107.555 Y91.824
G1 X106.008 Y90.277 E.06723
G1 X105.798 Y90.6
G1 X107.555 Y92.358 E.07637
G1 X107.555 Y92.891
G1 X105.587 Y90.923 E.08551
G1 X105.377 Y91.246
G1 X107.555 Y93.424 E.09465
G1 X107.555 Y93.957
G1 X105.166 Y91.568 E.10379
G1 X104.956 Y91.891
G1 X107.555 Y94.49 E.11293
G1 X107.554 Y95.023
G1 X104.745 Y92.214 E.12207
; WIPE_START
M204 S6000
G1 X106.16 Y93.628 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X110.353 Y87.251 Z3.4 F42000
G1 X112.083 Y84.62 Z3.4
G1 Z3
G1 E.8 F1800
G1 F12000
M204 S2000
G1 X111.361 Y83.899 E.03134
G1 X110.828 Y83.899
G1 X112.083 Y85.153 E.05451
G1 X112.083 Y85.686
G1 X110.295 Y83.899 E.07768
G1 X109.762 Y83.899
G1 X112.083 Y86.22 E.10086
G1 X112.083 Y86.753
G1 X109.69 Y84.361 E.10395
G1 X109.494 Y84.698
G1 X112.083 Y87.286 E.11247
G1 X112.083 Y87.819
G1 X109.494 Y85.231 E.11247
G1 X109.494 Y85.765
G1 X112.083 Y88.353 E.11247
G1 X112.083 Y88.886
G1 X109.494 Y86.298 E.11247
G1 X109.494 Y86.831
G1 X112.083 Y89.419 E.11247
G1 X112.083 Y89.953
G1 X109.494 Y87.364 E.11247
G1 X109.494 Y87.898
G1 X112.083 Y90.486 E.11247
G1 X112.083 Y91.019
G1 X109.494 Y88.431 E.11247
G1 X109.494 Y88.964
G1 X112.083 Y91.552 E.11247
G1 X112.083 Y92.086
G1 X109.494 Y89.497 E.11247
G1 X109.494 Y90.031
G1 X112.083 Y92.619 E.11247
G1 X112.083 Y93.152
M73 P95 R0
G1 X109.494 Y90.564 E.11247
G1 X109.494 Y91.097
G1 X112.083 Y93.685 E.11247
G1 X112.083 Y94.219
G1 X109.494 Y91.63 E.11247
G1 X109.494 Y92.164
G1 X112.083 Y94.752 E.11247
G1 X112.083 Y95.285
G1 X109.494 Y92.697 E.11247
G1 X109.494 Y93.23
G1 X112.083 Y95.818 E.11247
G1 X111.832 Y96.101
G1 X109.494 Y93.763 E.10159
G1 X109.494 Y94.297
G1 X111.299 Y96.101 E.07842
G1 X110.766 Y96.101
G1 X109.494 Y94.83 E.05524
G1 X109.481 Y95.349
G1 X110.232 Y96.101 E.03268
G1 X109.699 Y96.101
G1 X108.947 Y95.349 E.03268
G1 X108.414 Y95.349
G1 X109.166 Y96.101 E.03268
G1 X108.633 Y96.101
G1 X107.881 Y95.349 E.03268
G1 X108.099 Y96.101
G1 X104.535 Y92.537 E.1549
G1 X104.324 Y92.859
G1 X107.566 Y96.101 E.14088
G1 X107.033 Y96.101
G1 X104.114 Y93.182 E.12685
G1 X103.903 Y93.505
G1 X106.5 Y96.101 E.11283
G1 X105.966 Y96.101
G1 X103.693 Y93.828 E.0988
G1 X103.482 Y94.15
G1 X105.433 Y96.101 E.08478
G1 X104.9 Y96.101
G1 X103.272 Y94.473 E.07075
G1 X103.061 Y94.796
G1 X104.367 Y96.101 E.05673
G1 X103.833 Y96.101
G1 X102.851 Y95.119 E.0427
G1 X102.548 Y95.349
G1 X103.3 Y96.101 E.03268
G1 X102.767 Y96.101
G1 X102.015 Y95.349 E.03268
G1 X101.482 Y95.349
G1 X102.234 Y96.101 E.03268
G1 X101.7 Y96.101
G1 X100.948 Y95.349 E.03268
G1 X101.167 Y96.101
G1 X97.277 Y92.211 E.16904
G1 X97.127 Y92.594
G1 X100.634 Y96.101 E.15239
G1 X100.101 Y96.101
G1 X96.977 Y92.978 E.13574
G1 X96.827 Y93.361
G1 X99.567 Y96.101 E.11909
G1 X99.034 Y96.101
G1 X96.677 Y93.744 E.10244
G1 X96.527 Y94.127
G1 X98.501 Y96.101 E.08579
G1 X97.968 Y96.101
G1 X96.377 Y94.51 E.06913
G1 X96.227 Y94.893
G1 X97.434 Y96.101 E.05248
G1 X96.901 Y96.101
G1 X96.076 Y95.277 E.03583
G1 X95.658 Y95.391
G1 X96.368 Y96.101 E.03084
G1 X95.835 Y96.101
G1 X95.125 Y95.391 E.03084
G1 X94.592 Y95.391
G1 X95.301 Y96.101 E.03084
G1 X94.768 Y96.101
G1 X90.15 Y91.483 E.20067
G1 X90.195 Y92.062
G1 X94.235 Y96.101 E.17553
G1 X93.702 Y96.101
G1 X90.166 Y92.566 E.15363
G1 X90.085 Y93.018
G1 X93.168 Y96.101 E.13397
G1 X92.635 Y96.101
G1 X89.96 Y93.426 E.11624
G1 X89.787 Y93.787
G1 X92.102 Y96.101 E.10058
G1 X91.568 Y96.101
G1 X89.573 Y94.106 E.08669
G1 X89.321 Y94.387
G1 X91.035 Y96.101 E.07449
G1 X90.502 Y96.101
G1 X89.028 Y94.627 E.06407
G1 X88.699 Y94.832
G1 X89.969 Y96.101 E.05516
G1 X89.435 Y96.101
G1 X88.336 Y95.002 E.04778
G1 X87.935 Y95.134
G1 X88.902 Y96.101 E.04204
G1 X88.369 Y96.101
G1 X87.502 Y95.234 E.03767
G1 X87.032 Y95.298
G1 X87.836 Y96.101 E.0349
G1 X87.302 Y96.101
G1 X86.534 Y95.333 E.0334
G1 X86.017 Y95.349
G1 X86.769 Y96.101 E.03268
G1 X86.236 Y96.101
G1 X85.484 Y95.349 E.03268
G1 X84.951 Y95.349
G1 X85.703 Y96.101 E.03268
G1 X85.169 Y96.101
G1 X84.417 Y95.349 E.03268
G1 X83.884 Y95.349
G1 X84.636 Y96.101 E.03268
G1 X84.103 Y96.101
G1 X83.351 Y95.349 E.03268
G1 X83.57 Y96.101
G1 X80.966 Y93.497 E.11316
G1 X80.966 Y94.03
G1 X83.036 Y96.101 E.08999
G1 X82.503 Y96.101
G1 X80.966 Y94.564 E.06681
G1 X80.966 Y95.097
G1 X81.97 Y96.101 E.04364
G1 X81.437 Y96.101
G1 X80.685 Y95.349 E.03268
G1 X80.151 Y95.349
G1 X80.903 Y96.101 E.03268
G1 X80.37 Y96.101
G1 X79.618 Y95.349 E.03268
G1 X79.085 Y95.349
G1 X79.837 Y96.101 E.03268
G1 X79.304 Y96.101
G1 X78.552 Y95.349 E.03268
G1 X78.018 Y95.349
G1 X78.77 Y96.101 E.03268
G1 X78.237 Y96.101
G1 X77.485 Y95.349 E.03268
G1 X76.952 Y95.349
G1 X77.704 Y96.101 E.03268
G1 X77.171 Y96.101
G1 X73.231 Y92.162 E.17118
G1 X73.047 Y92.511
G1 X76.637 Y96.101 E.15603
G1 X76.104 Y96.101
G1 X72.862 Y92.859 E.14088
G1 X72.677 Y93.208
G1 X75.571 Y96.101 E.12573
M73 P96 R0
G1 X75.037 Y96.101
G1 X72.493 Y93.556 E.11058
G1 X72.308 Y93.905
G1 X74.504 Y96.101 E.09543
G1 X73.971 Y96.101
G1 X72.124 Y94.254 E.08028
G1 X71.939 Y94.602
G1 X73.438 Y96.101 E.06513
G1 X72.904 Y96.101
G1 X71.754 Y94.951 E.04998
G1 X71.57 Y95.3
G1 X72.371 Y96.101 E.03483
G1 X71.838 Y96.101
G1 X71.086 Y95.349 E.03268
G1 X70.553 Y95.349
G1 X71.305 Y96.101 E.03268
G1 X70.771 Y96.101
G1 X70.019 Y95.349 E.03268
G1 X69.486 Y95.349
G1 X70.238 Y96.101 E.03268
G1 X69.705 Y96.101
G1 X67.917 Y94.314 E.07768
G1 X67.917 Y94.847
G1 X69.172 Y96.101 E.0545
G1 X68.638 Y96.101
G1 X67.917 Y95.38 E.03133
; WIPE_START
M204 S6000
G1 X68.638 Y96.101 E-.38748
G1 X69.172 Y96.101 E-.20264
G1 X68.856 Y95.785 E-.16989
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X76.488 Y95.699 Z3.4 F42000
G1 X109.288 Y95.33 Z3.4
G1 Z3
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.102468
G1 F15000
M204 S6000
G1 X109.267 Y95.36 E.00018
G1 X109.383 Y95.447 E.0007
; WIPE_START
G1 X109.267 Y95.36 E-.60698
G1 X109.288 Y95.33 E-.15302
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X108.341 Y96.076 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.102661
G1 F15000
M204 S6000
G1 X108.171 Y96.101 E.00084
M204 S10000
G1 X107.809 Y95.35 F42000
G1 F15000
M204 S6000
G1 X107.639 Y95.374 E.00084
; WIPE_START
G1 X107.809 Y95.35 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X100.877 Y95.35 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.105909
G1 F15000
M204 S6000
G1 X100.741 Y95.363 E.0007
G1 X100.612 Y95.234 E.00094
; WIPE_START
G1 X100.741 Y95.363 E-.43545
G1 X100.877 Y95.35 E-.32455
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X101.409 Y96.076 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.102661
G1 F15000
M204 S6000
G1 X101.239 Y96.101 E.00084
; WIPE_START
G1 X101.409 Y96.076 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.664 Y92.504 Z3.4 F42000
G1 X88.874 Y89.436 Z3.4
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.0954952
G1 F15000
M204 S6000
G1 X88.79 Y89.366 E.00047
; LINE_WIDTH: 0.127263
G1 X88.645 Y89.255 E.00126
; LINE_WIDTH: 0.175674
G1 X88.499 Y89.144 E.00198
; LINE_WIDTH: 0.212279
G1 X88.37 Y89.054 E.00217
; WIPE_START
G1 X88.499 Y89.144 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.022 Y90.697 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.195681
G1 F15000
M204 S6000
G1 X89.936 Y90.575 E.00186
; LINE_WIDTH: 0.15905
G1 X89.847 Y90.449 E.00146
; LINE_WIDTH: 0.127178
G1 X89.771 Y90.353 E.00084
; LINE_WIDTH: 0.101176
G1 X89.695 Y90.257 E.00058
; WIPE_START
G1 X89.771 Y90.353 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X90.245 Y92.378 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.0958767
G1 F15000
M204 S6000
G3 X90.166 Y92.544 I-3.047 J-1.344 E.00079
; WIPE_START
G1 X90.245 Y92.378 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X94.59 Y95.393 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.167966
G1 F15000
M204 S6000
G1 X94.458 Y95.433 E.00141
G1 X94.3 Y95.276 E.00227
; WIPE_START
G1 X94.458 Y95.433 E-.46894
G1 X94.59 Y95.393 E-.29106
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X88.613 Y90.647 Z3.4 F42000
G1 X80.974 Y84.583 Z3.4
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.0981841
G1 F15000
M204 S6000
G1 X80.974 Y84.956 E.00168
; WIPE_START
G1 X80.974 Y84.583 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X81.429 Y83.969 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.143704
G1 F15000
M204 S6000
G2 X81.143 Y83.927 I-.193 J.324 E.00244
; WIPE_START
G1 X81.329 Y83.927 E-.47975
G1 X81.429 Y83.969 E-.28025
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X82.654 Y91.503 Z3.4 F42000
G1 X83.279 Y95.35 Z3.4
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.102664
G1 F15000
M204 S6000
G1 X83.109 Y95.374 E.00084
M204 S10000
G1 X83.811 Y96.076 F42000
; LINE_WIDTH: 0.102665
G1 F15000
M204 S6000
G1 X83.641 Y96.101 E.00084
; WIPE_START
G1 X83.811 Y96.076 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X79.087 Y95.347 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.164228
G1 F15000
M204 S6000
G1 X78.952 Y95.392 E.00142
G1 X78.907 Y95.348 E.00062
G1 X78.953 Y95.212 E.00142
; WIPE_START
G1 X78.907 Y95.348 E-.31164
G1 X78.952 Y95.392 E-.13672
G1 X79.087 Y95.347 E-.31164
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.242 Y94.384 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.198884
G1 F15000
M204 S6000
G1 X78.126 Y94.229 E.00245
; LINE_WIDTH: 0.154595
G1 X78.011 Y94.075 E.00175
; LINE_WIDTH: 0.110306
G1 X77.895 Y93.921 E.00106
; WIPE_START
G1 X78.011 Y94.075 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X78.795 Y86.483 Z3.4 F42000
G1 X78.969 Y84.797 Z3.4
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.0958574
G1 F15000
M204 S6000
G1 X78.639 Y84.468 E.00201
; WIPE_START
G1 X78.969 Y84.797 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X75.684 Y89.693 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.198864
G1 F15000
M204 S6000
G1 X75.569 Y89.539 E.00245
; LINE_WIDTH: 0.154588
G1 X75.454 Y89.385 E.00175
; LINE_WIDTH: 0.110313
G1 X75.338 Y89.23 E.00106
; WIPE_START
G1 X75.454 Y89.385 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X76.324 Y90.866 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.198884
G1 F15000
M204 S6000
G1 X76.208 Y90.712 E.00245
; LINE_WIDTH: 0.154595
G1 X76.093 Y90.557 E.00175
; LINE_WIDTH: 0.110306
G1 X75.977 Y90.403 E.00106
; WIPE_START
G1 X76.093 Y90.557 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X76.963 Y92.039 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.198884
G1 F15000
M204 S6000
G1 X76.848 Y91.884 E.00245
; LINE_WIDTH: 0.154595
G1 X76.732 Y91.73 E.00175
; LINE_WIDTH: 0.110306
G1 X76.617 Y91.576 E.00106
; WIPE_START
G1 X76.732 Y91.73 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X77.602 Y93.211 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.19887
G1 F15000
M204 S6000
G1 X77.487 Y93.057 E.00245
; LINE_WIDTH: 0.154592
G1 X77.371 Y92.902 E.00175
; LINE_WIDTH: 0.110314
G1 X77.256 Y92.748 E.00106
; WIPE_START
G1 X77.371 Y92.902 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X76.131 Y94.767 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; LINE_WIDTH: 0.105956
G1 F15000
M204 S6000
G1 X76.052 Y94.661 E.00068
; LINE_WIDTH: 0.141517
G1 X75.974 Y94.555 E.00106
; LINE_WIDTH: 0.174487
G1 X75.886 Y94.436 E.00159
; LINE_WIDTH: 0.20487
G1 X75.797 Y94.317 E.00195
M204 S10000
G1 X75.522 Y93.625 F42000
; LINE_WIDTH: 0.110156
G1 F15000
M204 S6000
G1 X75.411 Y93.475 E.00102
; LINE_WIDTH: 0.154118
G1 X75.3 Y93.325 E.00169
; LINE_WIDTH: 0.19808
G1 X75.189 Y93.176 E.00236
M204 S10000
G1 X74.913 Y92.483 F42000
; LINE_WIDTH: 0.110156
G1 F15000
M204 S6000
G1 X74.802 Y92.333 E.00102
; LINE_WIDTH: 0.154118
G1 X74.691 Y92.183 E.00169
; LINE_WIDTH: 0.19808
G1 X74.58 Y92.034 E.00236
M204 S10000
G1 X74.305 Y91.341 F42000
; LINE_WIDTH: 0.106956
G1 F15000
M204 S6000
G1 X74.225 Y91.234 E.00069
; LINE_WIDTH: 0.144517
G1 X74.146 Y91.127 E.0011
; LINE_WIDTH: 0.182078
G1 X74.067 Y91.02 E.00151
; LINE_WIDTH: 0.220343
G1 X73.985 Y90.91 E.002
; LINE_WIDTH: 0.219813
G1 X73.954 Y90.925 E.0005
; LINE_WIDTH: 0.179446
G1 X73.923 Y90.94 E.00038
; LINE_WIDTH: 0.139078
G1 X73.892 Y90.956 E.00027
; LINE_WIDTH: 0.103544
G1 X73.817 Y91.057 E.00062
; WIPE_START
G1 X73.892 Y90.956 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X81.492 Y91.651 Z3.4 F42000
G1 X95.244 Y92.908 Z3.4
G1 Z3
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F12000
M204 S5000
G1 X94.993 Y92.144 E.02472
G1 X93.905 Y89.275 E.09429
G1 X96.584 Y89.275 E.08234
G1 X96.573 Y89.306 E.00102
G1 X95.507 Y92.143 E.09311
G2 X95.261 Y92.851 I8.247 J3.257 E.02304
; WIPE_START
M204 S6000
G1 X94.993 Y92.144 E-.2873
G1 X94.552 Y90.981 E-.47271
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X96.102 Y89.97 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; FEATURE: Top surface
G1 F12000
M204 S2000
G1 X95.615 Y89.482 E.02117
G1 X95.082 Y89.482
G1 X95.956 Y90.357 E.03801
G1 X95.811 Y90.745
G1 X94.548 Y89.482 E.05485
G1 X94.321 Y89.789
G1 X95.665 Y91.132 E.05839
G1 X95.519 Y91.52
G1 X94.647 Y90.648 E.0379
; WIPE_START
M204 S6000
G1 X95.519 Y91.52 E-.46872
G1 X95.665 Y91.132 E-.15735
G1 X95.416 Y90.883 E-.13393
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X88.033 Y92.819 Z3.4 F42000
G1 X84.726 Y93.686 Z3.4
G1 Z3
G1 E.8 F1800
; FEATURE: Outer wall
G1 F12000
M204 S5000
G1 X84.726 Y90.221 E.10647
G1 X86.183 Y90.223 E.04477
G3 X87.574 Y90.493 I.126 J3.062 E.04394
G3 X88.336 Y91.778 I-.731 J1.303 E.04806
G3 X88.097 Y93.003 I-1.959 J.254 E.03903
G3 X87.235 Y93.556 I-1.137 J-.826 E.03221
G3 X86.049 Y93.686 I-1.172 J-5.22 E.03674
G1 X84.786 Y93.686 E.03881
; WIPE_START
M204 S6000
G1 X84.751 Y91.686 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.062 Y90.528 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; FEATURE: Top surface
G1 F12000
M204 S2000
G1 X88.095 Y91.561 E.04491
G1 X88.126 Y92.125
G1 X86.442 Y90.442 E.07314
G1 X85.897 Y90.43
G1 X88.054 Y92.586 E.09373
G1 X87.879 Y92.945
G1 X85.363 Y90.429 E.10936
G1 X84.933 Y90.532
G1 X87.589 Y93.188 E.11539
G1 X87.211 Y93.344
G1 X84.933 Y91.066 E.09899
G1 X84.933 Y91.599
G1 X86.765 Y93.43 E.07959
G1 X86.271 Y93.47
G1 X84.933 Y92.132 E.05814
G1 X84.933 Y92.665
G1 X85.746 Y93.478 E.03532
; WIPE_START
M204 S6000
G1 X84.933 Y92.665 E-.43675
G1 X84.933 Y92.132 E-.20264
G1 X85.158 Y92.357 E-.12061
; WIPE_END
G1 E-.04 F1800
M204 S10000
G1 X87.911 Y91.082 Z3.4 F42000
G1 Z3
G1 E.8 F1800
; FEATURE: Gap infill
; LINE_WIDTH: 0.104548
M73 P97 R0
G1 F15000
M204 S6000
G2 X87.553 Y90.725 I-2.488 J2.138 E.00255
; close powerlost recovery
M1003 S0
; WIPE_START
G1 F15000
G1 X87.687 Y90.837 E-.26168
G1 X87.911 Y91.082 E-.49832
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3.4 I1.217 J0 P1  F42000
M106 S0
M981 S0 P20000 ; close spaghetti detector
; FEATURE: Custom
; MACHINE_END_GCODE_START
; filament end gcode 

;===== date: 20260513 =====================
;turn off nozzle clog detect
G392 S0

M400 ; wait for buffer to clear
G92 E0 ; zero the extruder
G90
G1 Z3.4 F900 ; lower z a little
G1 X0 Y90 F18000 ; move to safe pos
G1 X-13.0 F3000 ; move to safe pos

M1002 judge_flag timelapse_record_flag
M622 J1
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M400 P100
M971 S11 C11 O0
M991 S0 P-1 ;end timelapse at safe pos
M623


M140 S0 ; turn off bed
M106 S0 ; turn off fan
M106 P2 S0 ; turn off remote part cooling fan
M106 P3 S0 ; turn off chamber cooling fan

;G1 X27 F15000 ; wipe

; pull back filament to AMS
M620 S255
G1 X181 F12000
T255
G1 X0 F18000
G1 X-13.0 F3000
G1 X0 F18000 ; wipe
M621 S255

M104 S0 ; turn off hotend

M400 ; wait all motion done
M17 S
M17 Z0.4 ; lower z motor current to reduce impact if there is something in the bottom

    G1 Z103 F600
    G1 Z101

M400 P100
M17 R ; restore z current

G90
G1 X-13 Y180 F3600

G91
G1 Z-1 F600
G90
M83

M220 S100  ; Reset feedrate magnitude
M201.2 K1.0 ; Reset acc magnitude
M73.2   R1.0 ;Reset left time magnitude
M1002 set_gcode_claim_speed_level : 0

;=====printer finish  sound=========
M17
M400 S1
M1006 S1
M1006 A0 B20 L100 C37 D20 M100 E42 F20 N100
M1006 A0 B10 L100 C44 D10 M100 E44 F10 N100
M1006 A0 B10 L100 C46 D10 M100 E46 F10 N100
M1006 A44 B20 L100 C39 D20 M100 E48 F20 N100
M1006 A0 B10 L100 C44 D10 M100 E44 F10 N100
M1006 A0 B10 L100 C0 D10 M100 E0 F10 N100
M1006 A0 B10 L100 C39 D10 M100 E39 F10 N100
M1006 A0 B10 L100 C0 D10 M100 E0 F10 N100
M1006 A0 B10 L100 C44 D10 M100 E44 F10 N100
M1006 A0 B10 L100 C0 D10 M100 E0 F10 N100
M1006 A0 B10 L100 C39 D10 M100 E39 F10 N100
M1006 A0 B10 L100 C0 D10 M100 E0 F10 N100
M1006 A44 B10 L100 C0 D10 M100 E48 F10 N100
M1006 A0 B10 L100 C0 D10 M100 E0 F10 N100
M1006 A44 B20 L100 C41 D20 M100 E49 F20 N100
M1006 A0 B20 L100 C0 D20 M100 E0 F20 N100
M1006 A0 B20 L100 C37 D20 M100 E37 F20 N100
M1006 W
;=====printer finish  sound=========
M400 S1
M18 X Y Z
M73 P100 R0
; EXECUTABLE_BLOCK_END

