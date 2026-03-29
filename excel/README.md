# JTZT Excel Demo

This folder contains the macro-enabled workbook and its single Python runtime module.

## What it does

- Uses the first sheet as the only input surface.
- Reads all inputs from cells, with no pop-up prompts.
- Uses the values already present on the sheet; the button never asks for extra input.
- Lets you switch between `read`, `mutate`, `schema`, `docs`, and `overview`.
- Supports date filters, generic filters, ordering, limits, offset, actions, and values JSON.
- Writes results into the `Output` sheet as a plain Excel-style table starting at row 1.

## How to use

Open `excel\JTZT_TimeEntries_Demo_Production.xlsm` in Excel.

- `excel\JTZT_TimeEntries_Demo_Production.xlsm`
- `excel\JTZT_TimeEntries_Demo_Production.py`

## Notes

- The workbook button runs the `SampleCall` macro from the embedded xlwings VBA project.
- The Python module must stay next to the workbook so xlwings can import it by workbook name.
- Rebuild the workbook with:
  - `python .\excel\JTZT_TimeEntries_Demo_Production.py --build`
