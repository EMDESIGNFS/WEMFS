// reportSections.js — the WEG-EM technical inspection checklist, distilled
// from the "WEG-EM REPORT MASTER" Word templates for Generators and
// Synchronous Motors. Both templates share the large majority of their
// sections (stator/rotor electrical testing, bearings, seals, air gaps,
// lubrication, vibration, operational test, etc.) — those are marked
// scope:'common'. Sections that only exist in one template are marked
// scope:'generator' or scope:'motor' (generator: diode wheel + collector
// ring + PMG air gap; synchronous motor: rotor pole drop test + Sync-Rite /
// SCR-FDR excitation testing).
//
// Row types (the `t` field), rendered generically by app.js and report.js:
//   'text'   — free-text input
//   'unit'   — numeric value + an SI-prefix unit dropdown (electrical units:
//              resistance/voltage/current/power/reactivePower/capacitance —
//              this is where the kilo/mega/giga prefix picker shows up)
//   'unit2'  — numeric value + a small fixed set of unit choices (o: [...])
//              for non-SI-prefixed units (inches, °C/°F, PSI, Gal/min, etc.)
//   'select' — a dropdown from fixed options (o: [...])
//   'dual'   — two related unit sub-fields on one row (e.g. an RTD's
//              continuity + insulation resistance)
//   'grid'   — a small table of number inputs (rows x cols), used for
//              repeating position/location measurements (o'clock positions,
//              shim locations, etc.)
// `p: true` on a text/unit/unit2/select row means it's an As-Found/As-Left
// pair — rendered as two side-by-side inputs and stored as {found, left}.

const UNIT_GROUPS = {
  resistance: { options: ['mΩ', 'Ω', 'kΩ', 'MΩ', 'GΩ'] },
  voltage: { options: ['mV', 'V', 'kV', 'MV'] },
  current: { options: ['mA', 'A', 'kA'] },
  power: { options: ['W', 'kW', 'MW', 'GW'] },
  reactivePower: { options: ['VAR', 'kVAR', 'MVAR'] },
  capacitance: { options: ['pF', 'nF', 'µF', 'mF'] }
};
window.UNIT_GROUPS = UNIT_GROUPS;

const REPORT_SECTIONS = [
  {
    "key": "nameplate",
    "title": "Equipment Nameplate & Exciter",
    "scope": "common",
    "rows": [
      {
        "t": "text",
        "k": "hp_kva",
        "l": "HP/KVA"
      },
      {
        "t": "text",
        "k": "rpm",
        "l": "RPM"
      },
      {
        "t": "unit",
        "k": "volts",
        "l": "Volts",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "amps",
        "l": "Amps",
        "g": "current",
        "u": "A"
      },
      {
        "t": "text",
        "k": "pf",
        "l": "PF"
      },
      {
        "t": "text",
        "k": "sf",
        "l": "SF"
      },
      {
        "t": "text",
        "k": "eq_type",
        "l": "Type"
      },
      {
        "t": "text",
        "k": "frame",
        "l": "Frame"
      },
      {
        "t": "select",
        "k": "horiz_vert",
        "l": "Horiz / Vert.",
        "o": [
          "Horizontal",
          "Vertical"
        ]
      },
      {
        "t": "text",
        "k": "num_poles",
        "l": "No. of Poles"
      },
      {
        "t": "text",
        "k": "enclosure",
        "l": "Enclosure"
      },
      {
        "t": "text",
        "k": "exciter_type",
        "l": "Exciter Type"
      },
      {
        "t": "text",
        "k": "exciter_size",
        "l": "Exciter Size"
      },
      {
        "t": "unit",
        "k": "exciter_fl_voltage",
        "l": "Exciter Full Load Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "exciter_fl_current",
        "l": "Exciter Full Load Current (DC)",
        "g": "current",
        "u": "A"
      }
    ]
  },
  {
    "key": "stator_insulation",
    "title": "Main Stator: Insulation Resistance & Step Voltage Testing",
    "scope": "common",
    "rows": [
      {
        "t": "unit",
        "k": "test_voltage",
        "l": "Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "phase_a_gnd",
        "l": "Phase A to ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "phase_b_gnd",
        "l": "Phase B to ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "phase_c_gnd",
        "l": "Phase C to ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "phase_abc_gnd",
        "l": "Phase A-B-C to ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "grid",
        "k": "step_5kV",
        "l": "Step Voltage 5kV",
        "rows": [
          "5kV"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "step_10kV",
        "l": "Step Voltage 10kV",
        "rows": [
          "10kV"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "step_15kV",
        "l": "Step Voltage 15kV",
        "rows": [
          "15kV"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "step_20kV",
        "l": "Step Voltage 20kV",
        "rows": [
          "20kV"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "step_25kV",
        "l": "Step Voltage 25kV",
        "rows": [
          "25kV"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "step_30kV",
        "l": "Step Voltage 30kV",
        "rows": [
          "30kV"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      }
    ]
  },
  {
    "key": "stator_winding_resistance",
    "title": "Main Stator: Winding Resistance Testing",
    "scope": "common",
    "rows": [
      {
        "t": "unit",
        "k": "test_current",
        "l": "Test Current (DC)",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "phase_a",
        "l": "Phase A 1-4",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "phase_b",
        "l": "Phase B 2-5",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "phase_c",
        "l": "Phase C 3-6",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      }
    ]
  },
  {
    "key": "stator_pi",
    "title": "Main Stator: Polarization Index Testing",
    "scope": "common",
    "rows": [
      {
        "t": "unit",
        "k": "test_voltage",
        "l": "Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "grid",
        "k": "min_1",
        "l": "1 Minute",
        "rows": [
          "1 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_2",
        "l": "2 Minutes",
        "rows": [
          "2 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_3",
        "l": "3 Minutes",
        "rows": [
          "3 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_4",
        "l": "4 Minutes",
        "rows": [
          "4 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_5",
        "l": "5 Minutes",
        "rows": [
          "5 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_6",
        "l": "6 Minutes",
        "rows": [
          "6 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_7",
        "l": "7 Minutes",
        "rows": [
          "7 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_8",
        "l": "8 Minutes",
        "rows": [
          "8 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_9",
        "l": "9 Minutes",
        "rows": [
          "9 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "min_10",
        "l": "10 Minutes",
        "rows": [
          "10 min"
        ],
        "cols": [
          "Phase A to ground",
          "Phase B to ground",
          "Phase C to ground"
        ],
        "u2": "MΩ"
      },
      {
        "t": "grid",
        "k": "pi_ratio",
        "l": "P.I. (10 min / 1 min ratio)",
        "rows": [
          "P.I."
        ],
        "cols": [
          "Phase A",
          "Phase B",
          "Phase C"
        ],
        "u2": ""
      },
      {
        "t": "grid",
        "k": "capacitance",
        "l": "Capacitance",
        "rows": [
          "Capacitance"
        ],
        "cols": [
          "Phase A",
          "Phase B",
          "Phase C"
        ],
        "u2": "µF"
      }
    ]
  },
  {
    "key": "stator_inspection",
    "title": "Main Stator: Inspection",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "core_grounded",
        "l": "The stator core correctly grounded to Earth",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "dowel_pins",
        "l": "Dowel pins are correctly installed in stator feet",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "cleanliness",
        "l": "Stator cleanliness",
        "o": [
          "Clean",
          "Contaminated"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "end_turn",
        "l": "End turn condition",
        "o": [
          "Clean",
          "Contaminated"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "blocking",
        "l": "Stator blocking condition",
        "o": [
          "Secure",
          "Loose"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "support_rings",
        "l": "Support rings condition",
        "o": [
          "Secure",
          "Loose"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "phase_leads",
        "l": "Phase leads condition",
        "o": [
          "Clean",
          "Contaminated"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "core_condition",
        "l": "Stator core condition",
        "o": [
          "Clean",
          "Oxidized"
        ],
        "p": true
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Stator overall observations / notes"
      }
    ]
  },
  {
    "key": "stator_aux",
    "title": "Main Stator: Auxiliary System (RTDs, Space Heaters, Grounding Transformer)",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "rtd_type",
        "l": "Stator RTD Type",
        "o": [
          "100Ω Platinum",
          "120Ω Nickel",
          "10Ω Copper"
        ]
      },
      {
        "t": "unit2",
        "k": "ambient_temp",
        "l": "Ambient Temperature of Stator",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "dual",
        "k": "rtd_1",
        "l": "Stator RTD 1",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_2",
        "l": "Stator RTD 2",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_3",
        "l": "Stator RTD 3",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_4",
        "l": "Stator RTD 4",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_5",
        "l": "Stator RTD 5",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_6",
        "l": "Stator RTD 6",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_7",
        "l": "Stator RTD 7",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_8",
        "l": "Stator RTD 8",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_9",
        "l": "Stator RTD 9",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_10",
        "l": "Stator RTD 10",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_11",
        "l": "Stator RTD 11",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "rtd_12",
        "l": "Stator RTD 12",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "select",
        "k": "heater_type",
        "l": "Space Heater Type",
        "o": [
          "3-Phase",
          "1-Phase"
        ]
      },
      {
        "t": "dual",
        "k": "heater_phase_1",
        "l": "Space Heater Phase 1",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "heater_phase_2",
        "l": "Space Heater Phase 2",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "heater_phase_3",
        "l": "Space Heater Phase 3",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "Ω"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "ngt_primary",
        "l": "Neutral Grounding Transformer — Primary",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "mΩ"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      },
      {
        "t": "dual",
        "k": "ngt_secondary",
        "l": "Neutral Grounding Transformer — Secondary",
        "fields": [
          {
            "k": "cont",
            "l": "Continuity",
            "g": "resistance",
            "u": "mΩ"
          },
          {
            "k": "insul",
            "l": "Insulation (500VDC to Gnd)",
            "g": "resistance",
            "u": "MΩ"
          }
        ]
      }
    ]
  },
  {
    "key": "terminal_box",
    "title": "Main Terminal Box Inspection",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "tb_0",
        "l": "Terminal box is securely bolted to foundation or structure",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_1",
        "l": "PT's and CT's are connected per drawings",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_2",
        "l": "PT and CT ratios are per drawings",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_3",
        "l": "Ring-type lugs used on all CT terminals",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_4",
        "l": "Shorting jumpers on all unused CT's",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_5",
        "l": "Shorting jumpers removed from active CT's",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_6",
        "l": "Sealing plates to main stator correctly installed and sealed",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_7",
        "l": "Lower sealing plate to field wiring correctly installed and sealed",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_8",
        "l": "Terminal box grounded correctly",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_9",
        "l": "Terminal box space heaters energized",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "unit",
        "k": "heater_voltage",
        "l": "Space heater voltage",
        "g": "voltage",
        "u": "V",
        "p": true
      },
      {
        "t": "select",
        "k": "tb_10",
        "l": "Hygroscopic foam correctly installed under top of terminal box",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_11",
        "l": "Evidence of oxidation or standing water inside terminal box",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_12",
        "l": "Gasket condition around terminal box door acceptable",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_13",
        "l": "Terminal box door locked during operation",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "tb_14",
        "l": "All door hardware correctly installed",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      }
    ]
  },
  {
    "key": "rotor_insulation",
    "title": "Main Rotor: Insulation & Winding Resistance",
    "scope": "common",
    "rows": [
      {
        "t": "unit",
        "k": "insul_test_voltage",
        "l": "Insulation Resistance Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "mf1_mf2_gnd",
        "l": "MF1 – MF2 to Shaft Ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "winding_test_current",
        "l": "Winding Resistance Test Current (DC)",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "mf1_mf2",
        "l": "MF1 – MF2",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      }
    ]
  },
  {
    "key": "rotor_pi",
    "title": "Main Rotor: Polarization Index Testing",
    "scope": "common",
    "rows": [
      {
        "t": "unit",
        "k": "test_voltage",
        "l": "Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "min_1",
        "l": "1 Minute (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_2",
        "l": "2 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_3",
        "l": "3 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_4",
        "l": "4 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_5",
        "l": "5 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_6",
        "l": "6 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_7",
        "l": "7 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_8",
        "l": "8 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_9",
        "l": "9 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "unit",
        "k": "min_10",
        "l": "10 Minutes (MF1–MF2 to Shaft Gnd)",
        "g": "resistance",
        "u": "MΩ"
      },
      {
        "t": "text",
        "k": "pi_ratio",
        "l": "P.I. (10 min / 1 min ratio)"
      },
      {
        "t": "unit",
        "k": "capacitance",
        "l": "Capacitance",
        "g": "capacitance",
        "u": "µF"
      }
    ]
  },
  {
    "key": "rotor_inspection",
    "title": "Main Rotor: Inspection",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "cage_bars",
        "l": "Condition of Cage Bars",
        "o": [
          "Clean",
          "Burnt"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "end_ring",
        "l": "End Ring Condition",
        "o": [
          "Clean",
          "Burnt"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "brazed_cage_end",
        "l": "Brazed Connections Between Cage Bars and End Rings",
        "o": [
          "Clean",
          "Oxidized"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "brazed_end_end",
        "l": "Brazed Connections Between End Rings",
        "o": [
          "Clean",
          "Oxidized"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "interpole",
        "l": "Inter-pole Connections",
        "o": [
          "Secure",
          "Loose"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "leads_diode",
        "l": "Main Rotor Leads to Diode Wheel",
        "o": [
          "Secure",
          "Loose"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "winding_condition",
        "l": "Overall Winding Condition",
        "o": [
          "Clean",
          "Contaminated"
        ],
        "p": true
      }
    ]
  },
  {
    "key": "exciter_testing",
    "title": "Brushless Exciter: Electrical Testing",
    "scope": "common",
    "rows": [
      {
        "t": "unit",
        "k": "rotor_insul_voltage",
        "l": "Exciter Rotor Insulation Resistance Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "rotor_insul",
        "l": "T1-T2-T3 to Shaft Ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "rotor_winding_current",
        "l": "Exciter Rotor Winding Resistance Test Current (DC)",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "t1_t2",
        "l": "T1-T2",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "t2_t5",
        "l": "T2-T5",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "t3_t6",
        "l": "T3-T6",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "stator_insul_voltage",
        "l": "Exciter Stator Insulation Resistance Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "ef1_ef2_gnd",
        "l": "EF1-EF2 to Ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "stator_winding_current",
        "l": "Exciter Stator Winding Resistance Test Current (DC)",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "ef1_ef2",
        "l": "EF1-EF2",
        "g": "resistance",
        "u": "mΩ",
        "p": true
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Brushless exciter observations / notes"
      }
    ]
  },
  {
    "key": "bearing_inspection",
    "title": "Bearing Inspection, Alignment & Electrical Testing",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "type_coupling",
        "l": "Type of bearings Coupling End",
        "o": [
          "Anti-Friction",
          "Sleeve"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "type_exciter",
        "l": "Type of bearings Exciter End",
        "o": [
          "Anti-Friction",
          "Sleeve"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "support_type",
        "l": "Type of Support",
        "o": [
          "Pedestal",
          "Bracket"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "shields_removed",
        "l": "Bearing and Oil Shields Removed",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "dowel_pins",
        "l": "Dowel pins installed on bearing upper cap, pedestal and base",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "cap_sealed",
        "l": "Bearing cap assemblies sealed with approved sealant",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "sensors_installed",
        "l": "Temperature sensors properly installed",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "sensors_functional",
        "l": "Temperature sensors functional",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "probes_insulated",
        "l": "Sensor probes insulated",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "oil_ring_coupling",
        "l": "Oil Ring Turns Freely Coupling End",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "oil_ring_exciter",
        "l": "Oil Ring Turns Freely Exciter End",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "residual_oil",
        "l": "Residual oil observed on brackets",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "unit2",
        "k": "wear_coupling_pct",
        "l": "Bearing Wear Pattern % — Coupling End",
        "o": [
          "%"
        ]
      },
      {
        "t": "text",
        "k": "wear_coupling_clock",
        "l": "Bearing Wear Location Reference (Clockface) — Coupling End"
      },
      {
        "t": "unit2",
        "k": "wear_exciter_pct",
        "l": "Bearing Wear Pattern % — Exciter End",
        "o": [
          "%"
        ]
      },
      {
        "t": "text",
        "k": "wear_exciter_clock",
        "l": "Bearing Wear Location Reference (Clockface) — Exciter End"
      },
      {
        "t": "unit",
        "k": "insul_test_voltage",
        "l": "Bearing Insulation Resistance Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "insul_coupling",
        "l": "Insulation Resistance — Coupling End",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "insul_exciter",
        "l": "Insulation Resistance — Exciter End",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "rtd_drive_1",
        "l": "Bearing RTD Resistance — Drive End RTD 1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "rtd_drive_2",
        "l": "Bearing RTD Resistance — Drive End RTD 2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "rtd_exciter_1",
        "l": "Bearing RTD Resistance — Exciter End RTD 1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "rtd_exciter_2",
        "l": "Bearing RTD Resistance — Exciter End RTD 2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "grid",
        "k": "align_drive_end",
        "l": "Bearing Alignment — Drive End Depth Measurement",
        "rows": [
          "Location 1",
          "Location 2",
          "Location 3",
          "Location 4"
        ],
        "cols": [
          "As Found",
          "As Left"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "align_non_drive_end",
        "l": "Bearing Alignment — Non Drive End Depth Measurement",
        "rows": [
          "Location 1",
          "Location 2",
          "Location 3",
          "Location 4"
        ],
        "cols": [
          "As Found",
          "As Left"
        ],
        "u2": "inches"
      },
      {
        "t": "unit2",
        "k": "sleeve_clearance_coupling",
        "l": "Sleeve Bearing Clearance (Plastigage at Top) — Coupling End",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "sleeve_clearance_exciter",
        "l": "Sleeve Bearing Clearance (Plastigage at Top) — Exciter End",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "end_float_coupling",
        "l": "Shaft End Float — Coupling End",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "end_float_exciter",
        "l": "Shaft End Float — Exciter End",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "grid",
        "k": "bearing_dia_coupling",
        "l": "Bearing Sleeve Diameter — Coupling End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "bearing_dia_exciter",
        "l": "Bearing Sleeve Diameter — Exciter End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Additional bearing observations / notes"
      }
    ]
  },
  {
    "key": "lubrication",
    "title": "Lubrication (Oil Rating & Lubrication Skid)",
    "scope": "common",
    "rows": [
      {
        "t": "text",
        "k": "oil_iso_nameplate",
        "l": "Oil Rating Per Nameplate (ISO rating)"
      },
      {
        "t": "text",
        "k": "oil_manufacturer",
        "l": "Oil Used — Manufacturer"
      },
      {
        "t": "text",
        "k": "oil_type",
        "l": "Oil Used — Type"
      },
      {
        "t": "text",
        "k": "oil_iso_rating",
        "l": "Oil Used — ISO Rating"
      },
      {
        "t": "select",
        "k": "reservoirs_clean",
        "l": "Oil Reservoirs Clean",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "select",
        "k": "orifices_installed",
        "l": "Oil Orifices Installed",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "unit2",
        "k": "orifice_size_coupling",
        "l": "Oil Orifice Size — Coupling End",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "orifice_size_exciter",
        "l": "Oil Orifice Size — Exciter End",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "select",
        "k": "skid_supplied_by",
        "l": "Lubrication System Supplied By",
        "o": [
          "EM",
          "Others"
        ]
      },
      {
        "t": "select",
        "k": "supply_lines_sized",
        "l": "Oil Supply Lines Sized Per Outline?",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "select",
        "k": "drain_lines_sized",
        "l": "Drain Lines Sized Per Outline?",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "unit2",
        "k": "drain_gradient",
        "l": "Drain Line Gradient",
        "o": [
          "Inches / ft"
        ]
      },
      {
        "t": "select",
        "k": "vapor_extractor",
        "l": "Vapor Extractor Installed on Oil Tank?",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "unit2",
        "k": "pressure",
        "l": "Pressure",
        "o": [
          "PSI",
          "kPa"
        ]
      },
      {
        "t": "unit2",
        "k": "flow_rate",
        "l": "Flow Rate",
        "o": [
          "Gal/min"
        ]
      },
      {
        "t": "select",
        "k": "flushed",
        "l": "Oil System Properly Flushed",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "select",
        "k": "drain_location",
        "l": "Location of Oil Drain With Respect to System Tank",
        "o": [
          "Above",
          "Below"
        ]
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Lubrication skid observations / notes"
      }
    ]
  },
  {
    "key": "shaft_oil_seals",
    "title": "Shaft Oil Seals",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "installed_sealed",
        "l": "Seals Installed and Sealed to EM Standards?",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "select",
        "k": "vent_hoses",
        "l": "Seal Vent Hoses Properly Connected and Unobstructed?",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "grid",
        "k": "clearance_coupling",
        "l": "Clearance — Coupling End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "clearance_exciter",
        "l": "Clearance — Exciter End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "diameter_coupling",
        "l": "Diameter — Coupling End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "diameter_exciter",
        "l": "Diameter — Exciter End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Observations / notes"
      }
    ]
  },
  {
    "key": "shaft_air_seals",
    "title": "Shaft Air Seals",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "installed_sealed",
        "l": "Seals Installed and Sealed to EM Standards?",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "select",
        "k": "vent_hoses",
        "l": "Seal Vent Hoses Properly Connected and Unobstructed?",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "grid",
        "k": "clearance_coupling",
        "l": "Clearance — Coupling End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "clearance_exciter",
        "l": "Clearance — Exciter End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "diameter_coupling",
        "l": "Diameter — Coupling End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "diameter_exciter",
        "l": "Diameter — Exciter End",
        "rows": [
          "3 o'clock",
          "6 o'clock",
          "9 o'clock",
          "12 o'clock"
        ],
        "cols": [
          "As Found Inboard",
          "As Found Outboard",
          "As Left Inboard",
          "As Left Outboard"
        ],
        "u2": "inches"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Observations / notes"
      }
    ]
  },
  {
    "key": "shaft_dimensions",
    "title": "Shaft Dimensions",
    "scope": "common",
    "rows": [
      {
        "t": "grid",
        "k": "journal_coupling",
        "l": "Coupling End Journal Diameter",
        "rows": [
          "A",
          "B",
          "C"
        ],
        "cols": [
          "Diameter"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "journal_exciter",
        "l": "Exciter End Journal Diameter",
        "rows": [
          "A",
          "B",
          "C"
        ],
        "cols": [
          "Diameter"
        ],
        "u2": "inches"
      },
      {
        "t": "unit2",
        "k": "oilseal_coupling_inboard",
        "l": "Coupling End Inboard Oil Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "oilseal_coupling_outboard",
        "l": "Coupling End Outboard Oil Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "oilseal_exciter_inboard",
        "l": "Exciter End Inboard Oil Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "oilseal_exciter_outboard",
        "l": "Exciter End Outboard Oil Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "airseal_coupling_inboard",
        "l": "Coupling End Inboard Air Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "airseal_coupling_outboard",
        "l": "Coupling End Outboard Air Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "airseal_exciter_inboard",
        "l": "Exciter End Inboard Air Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "airseal_exciter_outboard",
        "l": "Exciter End Outboard Air Seal Diameter",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Shaft observations / notes"
      }
    ]
  },
  {
    "key": "main_rotor_air_gap",
    "title": "Main Rotor Air Gap",
    "scope": "common",
    "rows": [
      {
        "t": "grid",
        "k": "air_gap",
        "l": "Air Gap (measured viewing motor end-on)",
        "rows": [
          "1:30",
          "3 o'clock",
          "4:30",
          "6 o'clock",
          "7:30",
          "9 o'clock",
          "10:30",
          "12 o'clock"
        ],
        "cols": [
          "Coupling End As Found",
          "Coupling End As Left",
          "Exciter End As Found",
          "Exciter End As Left"
        ],
        "u2": "thousandths of an inch"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Main rotor air gap observations / notes"
      }
    ]
  },
  {
    "key": "exciter_air_gap",
    "title": "Brushless Exciter Air Gap",
    "scope": "common",
    "rows": [
      {
        "t": "grid",
        "k": "air_gap",
        "l": "Air Gap (measured viewing exciter end-on)",
        "rows": [
          "1:30",
          "3 o'clock",
          "4:30",
          "6 o'clock",
          "7:30",
          "9 o'clock",
          "10:30",
          "12 o'clock"
        ],
        "cols": [
          "Exciter End As Found",
          "Exciter End As Left"
        ],
        "u2": "thousandths of an inch"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Brushless exciter air gap observations / notes"
      }
    ]
  },
  {
    "key": "air_gap_measurements",
    "title": "Air Gap Measurements (Air Baffle to Rotor Fan Blade)",
    "scope": "common",
    "rows": [
      {
        "t": "grid",
        "k": "air_gap",
        "l": "Air Baffle to Rotor Fan Blade Clearance",
        "rows": [
          "1:30",
          "3 o'clock",
          "4:30",
          "6 o'clock",
          "7:30",
          "9 o'clock",
          "10:30",
          "12 o'clock"
        ],
        "cols": [
          "Coupling End As Found",
          "Coupling End As Left",
          "Exciter End As Found",
          "Exciter End As Left"
        ],
        "u2": "thousandths of an inch"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Observations / notes"
      }
    ]
  },
  {
    "key": "frame_soft_foot",
    "title": "Frame and Soft Foot Check",
    "scope": "common",
    "rows": [
      {
        "t": "grid",
        "k": "shim_pack",
        "l": "Shim Pack Height",
        "rows": [
          "Location 1",
          "Location 2",
          "Location 3",
          "Location 4"
        ],
        "cols": [
          "As Found",
          "As Left"
        ],
        "u2": "inches"
      },
      {
        "t": "grid",
        "k": "soft_foot_soleplate",
        "l": "Soft Foot Check — Motor Foot To Soleplate",
        "rows": [
          "Location 1",
          "Location 2",
          "Location 3",
          "Location 4"
        ],
        "cols": [
          "As Found",
          "As Left"
        ],
        "u2": "thousandths of an inch"
      },
      {
        "t": "grid",
        "k": "soft_foot_foundation",
        "l": "Soft Foot Check — Soleplate to Foundation",
        "rows": [
          "Location 1",
          "Location 2",
          "Location 3",
          "Location 4",
          "Location 5",
          "Location 6"
        ],
        "cols": [
          "As Found",
          "As Left"
        ],
        "u2": "thousandths of an inch"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Frame and soft foot observations / notes"
      }
    ]
  },
  {
    "key": "vibration_sensors",
    "title": "Auxiliary Equipment: Vibration Sensors",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "type",
        "l": "Type",
        "o": [
          "Proximity Probe",
          "Velocity"
        ]
      },
      {
        "t": "unit",
        "k": "gap_voltage",
        "l": "Proximity Probe Gap Voltage",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "coupling_horizontal",
        "l": "Coupling End Horizontal",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "coupling_vertical",
        "l": "Coupling End Vertical",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "exciter_horizontal",
        "l": "Exciter End Horizontal",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "exciter_vertical",
        "l": "Exciter End Vertical",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit2",
        "k": "alarm_setpoint",
        "l": "Alarm Setpoint",
        "o": [
          "mm/s",
          "mils"
        ]
      },
      {
        "t": "unit2",
        "k": "trip_setpoint",
        "l": "Trip Setpoint",
        "o": [
          "mm/s",
          "mils"
        ]
      }
    ]
  },
  {
    "key": "water_coolers",
    "title": "Auxiliary Equipment: Water Coolers & RTDs",
    "scope": "common",
    "rows": [
      {
        "t": "unit2",
        "k": "water_pressure",
        "l": "Water Pressure",
        "o": [
          "PSI",
          "kPa"
        ]
      },
      {
        "t": "unit2",
        "k": "flow_rate",
        "l": "Flow Rate",
        "o": [
          "Gal/min"
        ]
      },
      {
        "t": "select",
        "k": "leak_detector",
        "l": "Leak Detector Installed and Functional?",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "unit",
        "k": "air_in_resistance",
        "l": "Air In RTD Resistance",
        "g": "resistance",
        "u": "Ω"
      },
      {
        "t": "unit2",
        "k": "air_in_alarm",
        "l": "Air In RTD Alarm Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit2",
        "k": "air_in_trip",
        "l": "Air In RTD Trip Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit",
        "k": "air_out_resistance",
        "l": "Air Out RTD Resistance",
        "g": "resistance",
        "u": "Ω"
      },
      {
        "t": "unit2",
        "k": "air_out_alarm",
        "l": "Air Out RTD Alarm Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit2",
        "k": "air_out_trip",
        "l": "Air Out RTD Trip Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit",
        "k": "water_in_resistance",
        "l": "Water In RTD Resistance",
        "g": "resistance",
        "u": "Ω"
      },
      {
        "t": "unit2",
        "k": "water_in_alarm",
        "l": "Water In RTD Alarm Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit2",
        "k": "water_in_trip",
        "l": "Water In RTD Trip Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit",
        "k": "water_out_resistance",
        "l": "Water Out RTD Resistance",
        "g": "resistance",
        "u": "Ω"
      },
      {
        "t": "unit2",
        "k": "water_out_alarm",
        "l": "Water Out RTD Alarm Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit2",
        "k": "water_out_trip",
        "l": "Water Out RTD Trip Setpoint",
        "o": [
          "°C",
          "°F"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_alarm",
        "l": "Stator RTD's Alarm Set Point",
        "o": [
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_trip",
        "l": "Stator RTD's Trip Set Point",
        "o": [
          "°C"
        ]
      }
    ]
  },
  {
    "key": "operation",
    "title": "Operational Test",
    "scope": "common",
    "rows": [
      {
        "t": "select",
        "k": "test_type",
        "l": "Operational Test",
        "o": [
          "Loaded",
          "Unloaded"
        ]
      },
      {
        "t": "unit2",
        "k": "test_duration",
        "l": "Test Duration",
        "o": [
          "Hours"
        ]
      },
      {
        "t": "unit2",
        "k": "ambient_temp",
        "l": "Ambient Temperature",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "humidity",
        "l": "Humidity",
        "o": [
          "%"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_1",
        "l": "Stator Temperature at Completion — RTD 1",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_2",
        "l": "Stator Temperature at Completion — RTD 2",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_3",
        "l": "Stator Temperature at Completion — RTD 3",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_4",
        "l": "Stator Temperature at Completion — RTD 4",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_5",
        "l": "Stator Temperature at Completion — RTD 5",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "stator_rtd_6",
        "l": "Stator Temperature at Completion — RTD 6",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "bearing_temp_coupling",
        "l": "Bearing Temperature at Completion — Coupling End",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "bearing_temp_exciter",
        "l": "Bearing Temperature at Completion — Exciter End",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "vib_coupling_horizontal",
        "l": "Vibration — Coupling End Horizontal",
        "o": [
          "mm/s",
          "mils"
        ]
      },
      {
        "t": "unit2",
        "k": "vib_coupling_vertical",
        "l": "Vibration — Coupling End Vertical",
        "o": [
          "mm/s",
          "mils"
        ]
      },
      {
        "t": "unit2",
        "k": "vib_coupling_axial",
        "l": "Vibration — Coupling End Axial",
        "o": [
          "mm/s",
          "mils"
        ]
      },
      {
        "t": "unit2",
        "k": "vib_exciter_horizontal",
        "l": "Vibration — Exciter End Horizontal",
        "o": [
          "mm/s",
          "mils"
        ]
      },
      {
        "t": "unit2",
        "k": "vib_exciter_vertical",
        "l": "Vibration — Exciter End Vertical",
        "o": [
          "mm/s",
          "mils"
        ]
      },
      {
        "t": "unit2",
        "k": "vib_exciter_axial",
        "l": "Vibration — Exciter End Axial",
        "o": [
          "mm/s",
          "mils"
        ]
      },
      {
        "t": "unit2",
        "k": "water_inlet_temp",
        "l": "Cooling Water Inlet Temperature",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "water_outlet_temp",
        "l": "Cooling Water Outlet Temperature",
        "o": [
          "°F",
          "°C"
        ]
      },
      {
        "t": "unit2",
        "k": "water_pressure",
        "l": "Cooling Water Pressure",
        "o": [
          "PSI",
          "kPa"
        ]
      },
      {
        "t": "unit2",
        "k": "water_flow_rate",
        "l": "Cooling Water Flow Rate",
        "o": [
          "Gal/min"
        ]
      },
      {
        "t": "text",
        "k": "starts_attempted",
        "l": "Number of Starts Attempted"
      },
      {
        "t": "select",
        "k": "synced_successfully",
        "l": "Synchronized Successfully",
        "o": [
          "Yes",
          "No"
        ]
      },
      {
        "t": "unit",
        "k": "excitation_no_load",
        "l": "No-Load Excitation Current (I0)",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "excitation_full_load",
        "l": "Full-Load Excitation Current (IFL)",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "stator_voltage_ab",
        "l": "Main Stator AB Phase Voltage",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "stator_voltage_bc",
        "l": "Main Stator BC Phase Voltage",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "stator_voltage_ac",
        "l": "Main Stator AC Phase Voltage",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "stator_current_a",
        "l": "Main Stator A Phase Current",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "stator_current_b",
        "l": "Main Stator B Phase Current",
        "g": "current",
        "u": "A"
      },
      {
        "t": "unit",
        "k": "stator_current_c",
        "l": "Main Stator C Phase Current",
        "g": "current",
        "u": "A"
      },
      {
        "t": "text",
        "k": "power_factor",
        "l": "Full-Load Power Factor"
      },
      {
        "t": "unit",
        "k": "power",
        "l": "Power",
        "g": "power",
        "u": "kW"
      },
      {
        "t": "unit",
        "k": "reactive_power",
        "l": "Reactive Power",
        "g": "reactivePower",
        "u": "kVAR"
      }
    ]
  },
  {
    "key": "gen_diode_series",
    "title": "Generator Diode Wheel: Series Redundant Testing",
    "scope": "generator",
    "rows": [
      {
        "t": "dual",
        "k": "module_1_ab",
        "l": "Module 1 — AB",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_1_ab_snubber",
        "l": "Module 1 — AB Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_1_bc",
        "l": "Module 1 — BC",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_1_bc_snubber",
        "l": "Module 1 — BC Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_2_ab",
        "l": "Module 2 — AB",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_2_ab_snubber",
        "l": "Module 2 — AB Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_2_bc",
        "l": "Module 2 — BC",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_2_bc_snubber",
        "l": "Module 2 — BC Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_3_ab",
        "l": "Module 3 — AB",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_3_ab_snubber",
        "l": "Module 3 — AB Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_3_bc",
        "l": "Module 3 — BC",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_3_bc_snubber",
        "l": "Module 3 — BC Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_4_ab",
        "l": "Module 4 — AB",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_4_ab_snubber",
        "l": "Module 4 — AB Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_4_bc",
        "l": "Module 4 — BC",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_4_bc_snubber",
        "l": "Module 4 — BC Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_5_ab",
        "l": "Module 5 — AB",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_5_ab_snubber",
        "l": "Module 5 — AB Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_5_bc",
        "l": "Module 5 — BC",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_5_bc_snubber",
        "l": "Module 5 — BC Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_6_ab",
        "l": "Module 6 — AB",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_6_ab_snubber",
        "l": "Module 6 — AB Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "module_6_bc",
        "l": "Module 6 — BC",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage (Passing Dir.)",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "module_6_bc_snubber",
        "l": "Module 6 — BC Snubber Capacitor Condition",
        "o": [
          "OK",
          "Blown"
        ]
      }
    ]
  },
  {
    "key": "gen_diode_parallel",
    "title": "Generator Diode Wheel: Parallel Redundant Testing",
    "scope": "generator",
    "rows": [
      {
        "t": "dual",
        "k": "forward_1",
        "l": "Forward 1",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "forward_1_fuse",
        "l": "Forward 1 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "forward_2",
        "l": "Forward 2",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "forward_2_fuse",
        "l": "Forward 2 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "forward_3",
        "l": "Forward 3",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "forward_3_fuse",
        "l": "Forward 3 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "forward_4",
        "l": "Forward 4",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "forward_4_fuse",
        "l": "Forward 4 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "forward_5",
        "l": "Forward 5",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "forward_5_fuse",
        "l": "Forward 5 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "forward_6",
        "l": "Forward 6",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "forward_6_fuse",
        "l": "Forward 6 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "reverse_1",
        "l": "Reverse 1",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "reverse_1_fuse",
        "l": "Reverse 1 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "reverse_2",
        "l": "Reverse 2",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "reverse_2_fuse",
        "l": "Reverse 2 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "reverse_3",
        "l": "Reverse 3",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "reverse_3_fuse",
        "l": "Reverse 3 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "reverse_4",
        "l": "Reverse 4",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "reverse_4_fuse",
        "l": "Reverse 4 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "reverse_5",
        "l": "Reverse 5",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "reverse_5_fuse",
        "l": "Reverse 5 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      },
      {
        "t": "dual",
        "k": "reverse_6",
        "l": "Reverse 6",
        "fields": [
          {
            "k": "blocking",
            "l": "Blocking Resistance @250VDC",
            "g": "resistance",
            "u": "kΩ"
          },
          {
            "k": "threshold",
            "l": "Threshold Voltage",
            "g": "voltage",
            "u": "V"
          }
        ]
      },
      {
        "t": "select",
        "k": "reverse_6_fuse",
        "l": "Reverse 6 Fuse Condition",
        "o": [
          "OK",
          "Blown"
        ]
      }
    ]
  },
  {
    "key": "gen_diode_inspection",
    "title": "Generator Diode Wheel: Inspection",
    "scope": "generator",
    "rows": [
      {
        "t": "select",
        "k": "insp_0",
        "l": "Internal wiring matches approved drawings",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "insp_1",
        "l": "Connections checked and tight",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "insp_2",
        "l": "Rectifier circuit grounded to rotor shaft",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "insp_3",
        "l": "All insulators inspected and acceptable",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "insp_4",
        "l": "Diode wheel assembly grounded to shaft",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "text",
        "k": "fuse_type_model",
        "l": "Fuse type and model number"
      },
      {
        "t": "select",
        "k": "gnd_detector_installed",
        "l": "Rotor Ground Detector Unit — Installed correctly",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "gnd_detector_aligned",
        "l": "Rotor Ground Detector Unit — Transmitter and Receiver Aligned",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "gnd_detector_tested",
        "l": "Rotor Ground Detector Unit — Functionally Tested",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "text",
        "k": "observations",
        "l": "Diode wheel observations / notes"
      }
    ]
  },
  {
    "key": "collector_ring",
    "title": "Collector Ring Inspection and Testing",
    "scope": "generator",
    "rows": [
      {
        "t": "select",
        "k": "ring_type",
        "l": "Collector Ring Type",
        "o": [
          "Split",
          "Continuous"
        ]
      },
      {
        "t": "select",
        "k": "surface_clean",
        "l": "Collector Rings Surface Smooth and Clean?",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "spark_gap_paint",
        "l": "Collector Ring Spark Gap Free of Paint?",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "unit2",
        "k": "spark_gap_setting",
        "l": "Spark Gap Setting",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit2",
        "k": "run_out",
        "l": "Collector Ring Run-Out (TIR)",
        "o": [
          "Inches"
        ]
      },
      {
        "t": "unit",
        "k": "insul_test_voltage",
        "l": "Collector Ring & Brush Holder Insulation Resistance Test Voltage (DC)",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "inboard_ring_gnd",
        "l": "Inboard: Collector Ring to Ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "outboard_ring_gnd",
        "l": "Outboard: Collector Ring to Ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "inboard_brush_gnd",
        "l": "Inboard: Brush Holder to Ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "unit",
        "k": "outboard_brush_gnd",
        "l": "Outboard: Brush Holder to Ground",
        "g": "resistance",
        "u": "MΩ",
        "p": true
      },
      {
        "t": "select",
        "k": "brush_holder_type",
        "l": "Brush Holder Type",
        "o": [
          "Constant Pressure",
          "Variable"
        ]
      },
      {
        "t": "select",
        "k": "red_pad",
        "l": "Red Insulating Pad on Brushes (recommended on all constant-pressure holders)",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "brushes_seated",
        "l": "All brushes properly seated",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      },
      {
        "t": "select",
        "k": "brushes_move_freely",
        "l": "Brushes Move Freely in Each Brush Holder Pocket",
        "o": [
          "Yes",
          "No"
        ],
        "p": true
      }
    ]
  },
  {
    "key": "pmg_air_gap",
    "title": "Permanent Magnet Generator (PMG) Air Gap",
    "scope": "generator",
    "rows": [
      {
        "t": "grid",
        "k": "air_gap",
        "l": "PMG Air Gap (measured viewing PMG end-on)",
        "rows": [
          "1:30",
          "3 o'clock",
          "4:30",
          "6 o'clock",
          "7:30",
          "9 o'clock",
          "10:30",
          "12 o'clock"
        ],
        "cols": [
          "As Found",
          "As Left"
        ],
        "u2": "thousandths of an inch"
      },
      {
        "t": "text",
        "k": "observations",
        "l": "PMG observations / notes"
      }
    ]
  },
  {
    "key": "rotor_pole_drop",
    "title": "Rotor Pole Drop Test",
    "scope": "motor",
    "rows": [
      {
        "t": "text",
        "k": "num_poles",
        "l": "Number of Poles"
      },
      {
        "t": "text",
        "k": "num_circuits",
        "l": "Number of Circuits in Winding"
      },
      {
        "t": "unit",
        "k": "applied_voltage",
        "l": "Applied Voltage Across Winding Circuit",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_1",
        "l": "Pole 1 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_2",
        "l": "Pole 2 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_3",
        "l": "Pole 3 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_4",
        "l": "Pole 4 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_5",
        "l": "Pole 5 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_6",
        "l": "Pole 6 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_7",
        "l": "Pole 7 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_8",
        "l": "Pole 8 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_9",
        "l": "Pole 9 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_10",
        "l": "Pole 10 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_11",
        "l": "Pole 11 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_12",
        "l": "Pole 12 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_13",
        "l": "Pole 13 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_14",
        "l": "Pole 14 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_15",
        "l": "Pole 15 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_16",
        "l": "Pole 16 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_17",
        "l": "Pole 17 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_18",
        "l": "Pole 18 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_19",
        "l": "Pole 19 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_20",
        "l": "Pole 20 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_21",
        "l": "Pole 21 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_22",
        "l": "Pole 22 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_23",
        "l": "Pole 23 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_24",
        "l": "Pole 24 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_25",
        "l": "Pole 25 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_26",
        "l": "Pole 26 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_27",
        "l": "Pole 27 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_28",
        "l": "Pole 28 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_29",
        "l": "Pole 29 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_30",
        "l": "Pole 30 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_31",
        "l": "Pole 31 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      },
      {
        "t": "unit",
        "k": "pole_32",
        "l": "Pole 32 AC Voltage Drop",
        "g": "voltage",
        "u": "V"
      }
    ]
  },
  {
    "key": "sync_rite",
    "title": "Universal Tester™: Sync-Rite™ Excitation Control",
    "scope": "motor",
    "rows": [
      {
        "t": "text",
        "k": "syncrite_unloaded_volts",
        "l": "Sync-Rite™ — Unloaded Volts",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_loaded_volts",
        "l": "Sync-Rite™ — Loaded Volts",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_zero_slip_0",
        "l": "Sync-Rite™ — Zero Slip 0",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_zero_slip_1",
        "l": "Sync-Rite™ — Zero Slip 1",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_zero_slip_2",
        "l": "Sync-Rite™ — Zero Slip 2",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_pulse_delay",
        "l": "Sync-Rite™ — Pulse Delay",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_pulse_height",
        "l": "Sync-Rite™ — Pulse Height",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_pulse_width",
        "l": "Sync-Rite™ — Pulse Width",
        "p": true
      },
      {
        "t": "text",
        "k": "syncrite_sync_speed",
        "l": "Sync-Rite™ — Sync Speed",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_zener_voltage",
        "l": "Sync-Rite™ Filter — Zener Voltage",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_capacitance",
        "l": "Sync-Rite™ Filter — Capacitance",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_d5_present",
        "l": "Sync-Rite™ Filter — D5 Present",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_d4_present",
        "l": "Sync-Rite™ Filter — D4 Present",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_resistance",
        "l": "Sync-Rite™ Filter — Resistance",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_ground",
        "l": "Sync-Rite™ Filter — Ground",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_sync_1",
        "l": "Sync-Rite™ Filter — Sync 1",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_sync_3",
        "l": "Sync-Rite™ Filter — Sync 3",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_sync_4",
        "l": "Sync-Rite™ Filter — Sync 4",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_sync_6",
        "l": "Sync-Rite™ Filter — Sync 6",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_t1",
        "l": "Sync-Rite™ Filter — T1",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_t2",
        "l": "Sync-Rite™ Filter — T2",
        "p": true
      },
      {
        "t": "text",
        "k": "syncritefilter_t3",
        "l": "Sync-Rite™ Filter — T3",
        "p": true
      }
    ]
  },
  {
    "key": "scr_fdr_testing",
    "title": "Universal Tester™: Forward/Reverse Diodes & SCR/FDR Testing",
    "scope": "motor",
    "rows": [
      {
        "t": "unit",
        "k": "forward_t1d1",
        "l": "Forward Diode T1D1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "forward_t1d2",
        "l": "Forward Diode T1D2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "forward_t2d1",
        "l": "Forward Diode T2D1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "forward_t2d2",
        "l": "Forward Diode T2D2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "forward_t3d1",
        "l": "Forward Diode T3D1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "forward_t3d2",
        "l": "Forward Diode T3D2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "reverse_t1d1",
        "l": "Reverse Diode T1D1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "reverse_t1d2",
        "l": "Reverse Diode T1D2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "reverse_t2d1",
        "l": "Reverse Diode T2D1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "reverse_t2d2",
        "l": "Reverse Diode T2D2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "reverse_t3d1",
        "l": "Reverse Diode T3D1",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "unit",
        "k": "reverse_t3d2",
        "l": "Reverse Diode T3D2",
        "g": "resistance",
        "u": "Ω",
        "p": true
      },
      {
        "t": "text",
        "k": "scr1_forward_block",
        "l": "SCR1 Test — Forward Block",
        "p": true
      },
      {
        "t": "text",
        "k": "scr1_reverse_block",
        "l": "SCR1 Test — Reverse Block",
        "p": true
      },
      {
        "t": "text",
        "k": "scr1_trigger",
        "l": "SCR1 Test — Trigger",
        "p": true
      },
      {
        "t": "text",
        "k": "scr2_forward_block",
        "l": "SCR2 Test — Forward Block",
        "p": true
      },
      {
        "t": "text",
        "k": "scr2_reverse_block",
        "l": "SCR2 Test — Reverse Block",
        "p": true
      },
      {
        "t": "text",
        "k": "scr2_trigger",
        "l": "SCR2 Test — Trigger",
        "p": true
      },
      {
        "t": "unit",
        "k": "fdr_resistance",
        "l": "FDR Test — Resistance",
        "g": "resistance",
        "u": "Ω",
        "p": true
      }
    ]
  }
];

window.REPORT_SECTIONS = REPORT_SECTIONS;
