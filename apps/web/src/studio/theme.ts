import { createStudioTheme } from 'ag-studio';

/**
 * Studio wears Bursar's tokens (`styles/app.css`): near-black surfaces, hairlines, and colour only where it
 * means something. In the charts, grey is neutral, green is allow, amber is waiting and red is deny.
 */
export const bursarStudioTheme = createStudioTheme().withParams({
  fontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
  fontSize: 13,
  backgroundColor: '#0e0f10',
  textColor: '#ececed',
  borderColor: '#212225',
  studioCanvasBackgroundColor: '#08090a',
  studioCanvasFontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
  studioWidgetBackgroundColor: '#0e0f10',
  studioWidgetBorder: { width: 1, color: '#212225' },
  studioWidgetBorderRadius: 8,
  studioWidgetTitleFontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
  studioWidgetTitleFontSize: 13,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: '#ececed',
  studioWidgetSubtitleTextColor: '#6a6c72',
  studioWidgetCaptionTextColor: '#6a6c72',
  gridRowBorder: { width: 1, color: '#212225' },
  gridHeaderRowBorder: { width: 1, color: '#2d2f33' },
  chartFontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
  chartTextColor: '#ececed',
  chartSubtleTextColor: '#6a6c72',
  chartAxisLineColor: '#2d2f33',
  chartGridLineColor: '#212225',
  chartPaletteFills1Color: '#9b9da3',
  chartPaletteFills2Color: '#4cb782',
  chartPaletteFills3Color: '#d9a441',
  chartPaletteFills4Color: '#e5484d',
  chartPaletteFills5Color: '#6a6c72',
  chartPaletteStrokes1Color: '#9b9da3',
  chartPaletteStrokes2Color: '#4cb782',
  chartPaletteStrokes3Color: '#d9a441',
  chartPaletteStrokes4Color: '#e5484d',
  chartPaletteStrokes5Color: '#6a6c72',
});
