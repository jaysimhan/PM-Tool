export const TAG_COLOR_PALETTE = [
    { hex: '#3b82f6', bg: 'bg-blue-100', text: 'text-blue-700' }, // Blue
    { hex: '#ef4444', bg: 'bg-red-100', text: 'text-red-700' },   // Red
    { hex: '#10b981', bg: 'bg-emerald-100', text: 'text-emerald-700' }, // Emerald
    { hex: '#f59e0b', bg: 'bg-amber-100', text: 'text-amber-700' }, // Amber
    { hex: '#8b5cf6', bg: 'bg-violet-100', text: 'text-violet-700' }, // Violet
    { hex: '#ec4899', bg: 'bg-pink-100', text: 'text-pink-700' }, // Pink
    { hex: '#06b6d4', bg: 'bg-cyan-100', text: 'text-cyan-700' }, // Cyan
    { hex: '#14b8a6', bg: 'bg-teal-100', text: 'text-teal-700' }, // Teal
    { hex: '#6366f1', bg: 'bg-indigo-100', text: 'text-indigo-700' }, // Indigo
    { hex: '#f43f5e', bg: 'bg-rose-100', text: 'text-rose-700' }, // Rose
];

export const getRandomColor = () => {
    return TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)].hex;
};

export const getDiverseColors = (count: number) => {
    const shuffled = [...TAG_COLOR_PALETTE].sort(() => 0.5 - Math.random());
    const result = [];
    for (let i = 0; i < count; i++) {
        result.push(shuffled[i % shuffled.length].hex);
    }
    return result;
};

export const getTagStyle = (hex: string | undefined) => {
    if (!hex) return { className: 'bg-gray-100 text-gray-700', style: {} };
    
    const colorDef = TAG_COLOR_PALETTE.find(c => c.hex.toLowerCase() === hex.toLowerCase());
    if (colorDef) {
        return { className: `${colorDef.bg} ${colorDef.text}`, style: {} };
    }
    
    // Fallback for any custom hex colors to create a pill-like style
    // Add 15% opacity for background (approx 26 in hex)
    return { className: '', style: { backgroundColor: `${hex}26`, color: hex } };
};
