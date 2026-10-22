/**
 * Every toggleable data layer. Each entry: { id, name, group, icon, note, create(viewer, ctx) }.
 * Flights and map overlays are listed in the Layers tab too but managed elsewhere.
 */
import ships from './ships';
import satellites from './satellites';
import nuclear from './nuclear';
import { militaryBases, bunkers } from './osmSites';
import quakes from './quakes';
import events from './events';
import radar from './radar';
import daynight from './daynight';

export const DATA_LAYERS = [ships, satellites, nuclear, militaryBases, bunkers, quakes, events, radar, daynight];

export const GROUPS = ['Air', 'Sea', 'Space', 'Sites', 'Hazards', 'Weather', 'Sky'];
