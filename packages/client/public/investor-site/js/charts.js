/**
 * 2451 Brickell Insights - Chart.js Visualizations
 * Using REAL sales data from 2451 Brickell Ave (251 recorded sales, 2001-2025)
 */

const ChartColors = {
    navy: '#003366',
    teal: '#00A896',
    tealLight: 'rgba(0, 168, 150, 0.2)',
    gold: '#D4A373',
    goldLight: 'rgba(212, 163, 115, 0.2)',
    red: '#e74c3c',
    redLight: 'rgba(231, 76, 60, 0.2)',
    gray: '#666666',
    gridLine: 'rgba(0, 0, 0, 0.05)'
};

const defaultOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
        legend: {
            display: true,
            position: 'bottom',
            labels: {
                font: { family: "'Roboto', sans-serif", size: 12 },
                padding: 20,
                usePointStyle: true
            }
        },
        tooltip: {
            backgroundColor: ChartColors.navy,
            titleFont: { family: "'Montserrat', sans-serif", weight: 'bold' },
            bodyFont: { family: "'Roboto', sans-serif" },
            padding: 12,
            cornerRadius: 8
        }
    },
    scales: {
        x: { grid: { display: false }, ticks: { font: { family: "'Roboto', sans-serif", size: 11 } } },
        y: { grid: { color: ChartColors.gridLine }, ticks: { font: { family: "'Roboto', sans-serif", size: 11 } } }
    }
};


// REAL DATA from 251 sales records (2001-2025)
const realSalesData = {
    // Historical implied building values by year (averaged from actual sales)
    historicalImpliedValues: [
        { year: '2013', avgImpliedValue: 120 },
        { year: '2014', avgImpliedValue: 127 },
        { year: '2015', avgImpliedValue: 134 },
        { year: '2016', avgImpliedValue: 148 },
        { year: '2017', avgImpliedValue: 124 },
        { year: '2018', avgImpliedValue: 151 },
        { year: '2019', avgImpliedValue: 131 },
        { year: '2020', avgImpliedValue: 134 },
        { year: '2021', avgImpliedValue: 159 },
        { year: '2022', avgImpliedValue: 168 },
        { year: '2023', avgImpliedValue: 241 },
        { year: '2024', avgImpliedValue: 247 },
        { year: '2025', avgImpliedValue: 213 }
    ],
    
    // Real 2024-2025 sales data
    recentSales: [
        // 2025 sales
        { date: '2025-10', unit: '#5E', price: 1400, sqft: 2189, beds: 3, implied: 272 },
        { date: '2025-10', unit: '#16K', price: 440, sqft: 886, beds: 1, implied: 211 },
        { date: '2025-10', unit: '#5G', price: 485, sqft: 1357, beds: 2, implied: 159 },
        { date: '2025-10', unit: '#10S', price: 475, sqft: 1188, beds: 2, implied: 171 },
        { date: '2025-09', unit: '#20H', price: 688, sqft: 1188, beds: 2, implied: 248 },
        { date: '2025-09', unit: '#3E', price: 615, sqft: 1188, beds: 2, implied: 222 },
        { date: '2025-08', unit: '#17G', price: 610, sqft: 1357, beds: 2, implied: 200 },
        { date: '2025-08', unit: '#20N', price: 470, sqft: 1012, beds: 1, implied: 195 },
        { date: '2025-07', unit: '#4L', price: 615, sqft: 1188, beds: 2, implied: 222 },
        { date: '2025-05', unit: '#12R', price: 360, sqft: 886, beds: 1, implied: 175 },
        { date: '2025-04', unit: '#PHK', price: 505, sqft: 886, beds: 1, implied: 243 },
        { date: '2025-03', unit: '#4J', price: 1150, sqft: 1703, beds: 3, implied: 290 },
        { date: '2025-03', unit: '#18N', price: 516, sqft: 1012, beds: 1, implied: 215 },
        { date: '2025-03', unit: '#18R', price: 485, sqft: 886, beds: 1, implied: 236 },
        { date: '2025-01', unit: '#6N', price: 425, sqft: 1012, beds: 1, implied: 177 },
        // 2024 sales
        { date: '2024-06', unit: '#9A', price: 685, sqft: 1305, beds: 2, implied: 219 },
        { date: '2024-05', unit: '#6T', price: 527, sqft: 832, beds: 1, implied: 253 },
        { date: '2024-05', unit: '#6P', price: 520, sqft: 832, beds: 1, implied: 253 },
        { date: '2024-05', unit: '#17R', price: 480, sqft: 886, beds: 1, implied: 233 },
        { date: '2024-05', unit: '#5S', price: 783, sqft: 1188, beds: 2, implied: 282 },
        { date: '2024-04', unit: '#6S', price: 718, sqft: 1188, beds: 2, implied: 259 },
        { date: '2024-04', unit: '#19C', price: 500, sqft: 886, beds: 1, implied: 240 },
        { date: '2024-02', unit: '#11K', price: 490, sqft: 886, beds: 1, implied: 235 }
    ],
    
    // Price per sq ft by bedroom type (2024-2025 actual data)
    pricePerSqftByType: {
        '1bed': { min: 357, max: 633, avg: 511 },
        '2bed': { min: 400, max: 659, avg: 531 },
        '3bed': { min: 640, max: 675, avg: 651 }
    }
};

/**
 * Historical Implied Building Value Chart (shows market volatility)
 */
function createImpliedValueChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const data = realSalesData.historicalImpliedValues;
    
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.year),
            datasets: [{
                label: 'Avg Implied Building Value ($M)',
                data: data.map(d => d.avgImpliedValue),
                borderColor: ChartColors.teal,
                backgroundColor: ChartColors.tealLight,
                borderWidth: 3,
                fill: true,
                tension: 0.3,
                pointRadius: 5,
                pointBackgroundColor: ChartColors.teal,
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            ...defaultOptions,
            plugins: {
                ...defaultOptions.plugins,
                title: {
                    display: true,
                    text: 'Based on 251 actual sales (2001-2025)',
                    font: { size: 11, weight: 'normal' },
                    color: '#666'
                }
            },
            scales: {
                ...defaultOptions.scales,
                y: { 
                    ...defaultOptions.scales.y, 
                    min: 100, 
                    max: 280,
                    ticks: { callback: (v) => '$' + v + 'M' } 
                }
            }
        }
    });
}

/**
 * Price Per Sq Ft by Unit Type (real 2024-2025 data)
 */
function createPricePerSqftChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const data = realSalesData.pricePerSqftByType;
    
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['1 Bedroom', '2 Bedroom', '3 Bedroom'],
            datasets: [{
                label: 'Average $/sq ft',
                data: [data['1bed'].avg, data['2bed'].avg, data['3bed'].avg],
                backgroundColor: [ChartColors.teal, ChartColors.navy, ChartColors.gold],
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            ...defaultOptions,
            plugins: { 
                ...defaultOptions.plugins, 
                legend: { display: false },
                title: {
                    display: true,
                    text: '2024-2025 actual sales (23 transactions)',
                    font: { size: 11, weight: 'normal' },
                    color: '#666'
                }
            },
            scales: {
                ...defaultOptions.scales,
                y: { 
                    ...defaultOptions.scales.y, 
                    beginAtZero: true, 
                    max: 750, 
                    ticks: { callback: (v) => '$' + v } 
                }
            }
        }
    });
}

/**
 * Entry vs Exit Comparison Chart (for investors page)
 */
function createEntryExitChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Current Implied Value\n(2024-2025 avg)', 'Exit Potential\n(Land Value)'],
            datasets: [{
                label: 'Valuation ($M)',
                data: [218, 615],  // Real data: avg implied value vs land value calc
                backgroundColor: [ChartColors.teal, ChartColors.gold],
                borderRadius: 12,
                borderSkipped: false,
                barPercentage: 0.6
            }]
        },
        options: {
            ...defaultOptions,
            indexAxis: 'y',
            plugins: { 
                ...defaultOptions.plugins, 
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataIndex === 0) return 'Based on 23 sales (2024-2025)';
                            return '8.3 acres × $1,700/sf = $615M';
                        }
                    }
                }
            },
            scales: {
                x: { ...defaultOptions.scales.x, max: 700, ticks: { callback: (v) => '$' + v + 'M' } },
                y: { grid: { display: false } }
            }
        }
    });
}

/**
 * Rent by Bedroom Type Chart - Range bars showing min/max/avg rent
 */
function createRentByBedsChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    const stats = getRentalMarketData();
    const data = stats.byBedroom;
    
    rentByBedsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['1 Bedroom', '2 Bedroom', '3 Bedroom'],
            datasets: [
                {
                    label: 'Rent Range',
                    data: [
                        data[1] ? [data[1].min, data[1].max] : [0, 0],
                        data[2] ? [data[2].min, data[2].max] : [0, 0],
                        data[3] ? [data[3].min, data[3].max] : [0, 0]
                    ],
                    backgroundColor: 'rgba(0, 168, 150, 0.3)',
                    borderColor: ChartColors.teal,
                    borderWidth: 2,
                    borderRadius: 8,
                    borderSkipped: false
                },
                {
                    label: 'Average Rent',
                    data: [
                        data[1] ? data[1].avg : null,
                        data[2] ? data[2].avg : null,
                        data[3] ? data[3].avg : null
                    ],
                    type: 'scatter',
                    backgroundColor: ChartColors.gold,
                    borderColor: '#fff',
                    borderWidth: 2,
                    pointRadius: 10,
                    pointStyle: 'circle'
                }
            ]
        },
        options: {
            ...defaultOptions,
            plugins: {
                ...defaultOptions.plugins,
                legend: { display: true },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.dataset.label === 'Rent Range') {
                                const beds = ctx.dataIndex + 1;
                                const currentStats = getRentalMarketData();
                                const d = currentStats.byBedroom[beds];
                                if (d && d.count > 0) {
                                    return `Range: $${d.min.toLocaleString()} - $${d.max.toLocaleString()}/mo (${d.count} rentals)`;
                                }
                                return 'No data for selected years';
                            }
                            if (ctx.raw) {
                                return `Average: $${ctx.raw.toLocaleString()}/mo`;
                            }
                            return 'No data';
                        }
                    }
                }
            },
            scales: {
                x: { ...defaultOptions.scales.x, grid: { display: false } },
                y: {
                    ...defaultOptions.scales.y,
                    min: 2000,
                    max: 7000,
                    ticks: {
                        callback: (v) => '$' + v.toLocaleString()
                    },
                    title: {
                        display: true,
                        text: 'Monthly Rent',
                        font: { size: 11 }
                    }
                }
            }
        }
    });
}

/**
 * Recent Sales Scatter Plot - Price per Sq Ft by Unit Size
 */
function createSalesScatterChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    const sales = realSalesData.recentSales;
    // Calculate price per sqft: price is in thousands, so (price * 1000) / sqft
    const oneBed = sales.filter(s => s.beds === 1).map(s => ({ x: s.sqft, y: Math.round((s.price * 1000) / s.sqft), unit: s.unit, price: s.price * 1000 }));
    const twoBed = sales.filter(s => s.beds === 2).map(s => ({ x: s.sqft, y: Math.round((s.price * 1000) / s.sqft), unit: s.unit, price: s.price * 1000 }));
    const threeBed = sales.filter(s => s.beds === 3).map(s => ({ x: s.sqft, y: Math.round((s.price * 1000) / s.sqft), unit: s.unit, price: s.price * 1000 }));
    
    return new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                { label: '1 Bedroom', data: oneBed, backgroundColor: ChartColors.teal, pointRadius: 8 },
                { label: '2 Bedroom', data: twoBed, backgroundColor: ChartColors.navy, pointRadius: 8 },
                { label: '3 Bedroom', data: threeBed, backgroundColor: ChartColors.gold, pointRadius: 10 }
            ]
        },
        options: {
            ...defaultOptions,
            plugins: {
                ...defaultOptions.plugins,
                title: {
                    display: true,
                    text: '23 actual sales (2024-2025)',
                    font: { size: 11, weight: 'normal' },
                    color: '#666'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const point = context.raw;
                            return [
                                `${context.dataset.label}: $${point.y}/sf`,
                                `Size: ${point.x.toLocaleString()} sf`,
                                `Sale: $${point.price.toLocaleString()}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { 
                    ...defaultOptions.scales.x, 
                    title: { display: true, text: 'Unit Size (Sq Ft)' }, 
                    ticks: { callback: (v) => v.toLocaleString() + ' sf' } 
                },
                y: { 
                    ...defaultOptions.scales.y, 
                    title: { display: true, text: 'Price per Sq Ft' }, 
                    ticks: { callback: (v) => '$' + v },
                    min: 300,
                    max: 700
                }
            }
        }
    });
}

/**
 * Price per Sq Ft by Bedroom Type - Range Chart
 * Shows min, max, and average price/sqft for each bedroom type
 */
function createPriceByBedsChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    const sales = realSalesData.recentSales;
    
    // Calculate price per sqft for each sale and group by beds
    const byBeds = { 1: [], 2: [], 3: [] };
    sales.forEach(s => {
        const ppsf = Math.round((s.price * 1000) / s.sqft);
        if (byBeds[s.beds]) byBeds[s.beds].push(ppsf);
    });
    
    // Calculate stats for box plot
    const stats = {};
    [1, 2, 3].forEach(beds => {
        const values = byBeds[beds].sort((a, b) => a - b);
        if (values.length > 0) {
            stats[beds] = {
                min: values[0],
                max: values[values.length - 1],
                avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
                count: values.length
            };
        }
    });
    
    // Custom plugin for fully rounded floating bars with averages on top
    const roundedBarsPlugin = {
        id: 'roundedBars',
        afterDatasetsDraw(chart) {
            const { ctx: context } = chart;
            const barMeta = chart.getDatasetMeta(0);
            const avgMeta = chart.getDatasetMeta(1);
            const bgColors = ['rgba(0, 168, 150, 0.25)', 'rgba(26, 54, 93, 0.25)', 'rgba(212, 163, 115, 0.25)'];
            const borderColors = [ChartColors.teal, ChartColors.navy, ChartColors.gold];
            
            // Draw rounded bars
            barMeta.data.forEach((bar, i) => {
                const { x, y, base, width } = bar;
                const top = Math.min(y, base);
                const bottom = Math.max(y, base);
                const height = bottom - top;
                const radius = Math.min(10, width / 2);
                
                context.save();
                context.beginPath();
                context.roundRect(x - width/2, top, width, height, radius);
                context.fillStyle = bgColors[i];
                context.fill();
                context.strokeStyle = borderColors[i];
                context.lineWidth = 2;
                context.stroke();
                context.restore();
            });
            
            // Draw average markers using bar x-positions for alignment
            const avgData = chart.data.datasets[1].data;
            const yScale = chart.scales.y;
            
            barMeta.data.forEach((bar, i) => {
                const avgValue = avgData[i];
                const x = bar.x;
                const y = yScale.getPixelForValue(avgValue);
                
                // Draw white circle with dark navy border - always draw
                context.save();
                context.beginPath();
                context.arc(x, y, 12, 0, Math.PI * 2);
                context.fillStyle = '#ffffff';
                context.fill();
                context.strokeStyle = '#003366';
                context.lineWidth = 4;
                context.stroke();
                context.restore();
            });
        }
    };
    
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['1 Bedroom', '2 Bedroom', '3 Bedroom'],
            datasets: [
                {
                    label: 'Price Range',
                    data: [
                        [stats[1]?.min || 0, stats[1]?.max || 0],
                        [stats[2]?.min || 0, stats[2]?.max || 0],
                        [stats[3]?.min || 0, stats[3]?.max || 0]
                    ],
                    backgroundColor: 'transparent',
                    borderColor: 'transparent',
                    borderWidth: 0,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7
                },
                {
                    label: 'Average',
                    type: 'line',
                    data: [stats[1]?.avg || 0, stats[2]?.avg || 0, stats[3]?.avg || 0],
                    borderColor: ChartColors.navy,
                    backgroundColor: '#fff',
                    borderWidth: 3,
                    pointRadius: 10,
                    pointStyle: 'circle',
                    pointBorderWidth: 3,
                    pointBackgroundColor: '#fff',
                    showLine: false
                }
            ]
        },
        options: {
            ...defaultOptions,
            plugins: {
                ...defaultOptions.plugins,
                title: {
                    display: true,
                    text: `${sales.length} sales (2024-2025)`,
                    font: { size: 11, weight: 'normal' },
                    color: '#666'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const bedIndex = context.dataIndex + 1;
                            const stat = stats[bedIndex];
                            if (context.dataset.label === 'Price Range') {
                                return [
                                    `Min: $${stat.min}/sf`,
                                    `Max: $${stat.max}/sf`,
                                    `Avg: $${stat.avg}/sf`,
                                    `(${stat.count} sales)`
                                ];
                            } else if (context.dataset.label === 'Average') {
                                return `Average: $${stat.avg}/sf`;
                            }
                            return '';
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: { size: 11 }
                    }
                }
            },
            scales: {
                x: { 
                    ...defaultOptions.scales.x,
                    grid: { display: false }
                },
                y: { 
                    ...defaultOptions.scales.y, 
                    title: { display: true, text: 'Price per Sq Ft' }, 
                    ticks: { callback: (v) => '$' + v },
                    min: 300,
                    max: 700
                }
            }
        },
        plugins: [roundedBarsPlugin]
    });
}

let priceByBedsChart = null;

function initPriceChartToggle() {
    const toggleSqft = document.getElementById('toggleSqft');
    const toggleBeds = document.getElementById('toggleBeds');
    const chartSqft = document.getElementById('priceChartSqft');
    const chartBeds = document.getElementById('priceChartBeds');
    
    if (!toggleSqft || !toggleBeds) return;
    
    toggleSqft.addEventListener('click', () => {
        toggleSqft.style.background = 'var(--white)';
        toggleSqft.style.color = 'var(--navy)';
        toggleSqft.style.fontWeight = '600';
        toggleBeds.style.background = 'transparent';
        toggleBeds.style.color = 'var(--text-light)';
        toggleBeds.style.fontWeight = '500';
        chartSqft.style.display = 'block';
        chartBeds.style.display = 'none';
    });
    
    toggleBeds.addEventListener('click', () => {
        toggleBeds.style.background = 'var(--white)';
        toggleBeds.style.color = 'var(--navy)';
        toggleBeds.style.fontWeight = '600';
        toggleSqft.style.background = 'transparent';
        toggleSqft.style.color = 'var(--text-light)';
        toggleSqft.style.fontWeight = '500';
        chartSqft.style.display = 'none';
        chartBeds.style.display = 'block';
        
        // Create chart on first view
        if (!priceByBedsChart) {
            priceByBedsChart = createPriceByBedsChart('priceByBedsChart');
        }
    });
}

/**
 * Total Return by Exit Scenario Chart
 * Shows the one-time arbitrage spread (182% base gain) plus additional market appreciation
 * Honest framing: leverage is a one-time entry discount, not a perpetual multiplier
 */
function createLeverageChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    // Core values
    const entryPrice = 218; // $218M implied value (what you pay)
    const currentLandValue = 615; // $615M actual land value
    
    // Base arbitrage gain - this is captured regardless of market movement
    const baseArbitrageGain = Math.round(((currentLandValue - entryPrice) / entryPrice) * 100); // 182%
    
    // Exit scenarios (land values in millions)
    const exitScenarios = [
        { landValue: 615, label: '$615M\n(Today)' },
        { landValue: 700, label: '$700M\n(+14%)' },
        { landValue: 800, label: '$800M\n(+30%)' },
        { landValue: 900, label: '$900M\n(+46%)' },
        { landValue: 1000, label: '$1B\n(+63%)' }
    ];
    
    // Calculate returns for each scenario
    const baseGains = exitScenarios.map(() => baseArbitrageGain); // Always 182%
    const additionalGains = exitScenarios.map(scenario => {
        const totalReturn = Math.round(((scenario.landValue - entryPrice) / entryPrice) * 100);
        return totalReturn - baseArbitrageGain; // Additional gain from market appreciation
    });
    
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: exitScenarios.map(s => s.label),
            datasets: [
                { 
                    label: 'Base Arbitrage Gain (Entry Discount)', 
                    data: baseGains, 
                    backgroundColor: ChartColors.teal,
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 },
                    borderSkipped: false,
                    barPercentage: 0.7,
                    categoryPercentage: 0.8
                },
                { 
                    label: 'Additional Market Appreciation', 
                    data: additionalGains, 
                    backgroundColor: ChartColors.gold,
                    borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
                    borderSkipped: false,
                    barPercentage: 0.7,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            ...defaultOptions,
            plugins: {
                ...defaultOptions.plugins,
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: { family: "'Roboto', sans-serif", size: 11 },
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    ...defaultOptions.plugins.tooltip,
                    callbacks: {
                        title: (ctx) => {
                            const scenario = exitScenarios[ctx[0].dataIndex];
                            return `Exit at $${scenario.landValue}M Land Value`;
                        },
                        label: (ctx) => {
                            const scenario = exitScenarios[ctx.dataIndex];
                            const totalReturn = Math.round(((scenario.landValue - entryPrice) / entryPrice) * 100);
                            const marketApprec = Math.round(((scenario.landValue - currentLandValue) / currentLandValue) * 100);
                            
                            if (ctx.datasetIndex === 0) {
                                return `Entry Discount: +${baseArbitrageGain}% (built-in)`;
                            } else {
                                return `Market Gain: +${ctx.raw}% (land up ${marketApprec}%)`;
                            }
                        },
                        afterBody: (ctx) => {
                            const scenario = exitScenarios[ctx[0].dataIndex];
                            const totalReturn = Math.round(((scenario.landValue - entryPrice) / entryPrice) * 100);
                            return [`───────────────`, `Total Return: +${totalReturn}%`];
                        }
                    }
                }
            },
            scales: {
                ...defaultOptions.scales,
                x: {
                    ...defaultOptions.scales.x,
                    stacked: true,
                    title: { 
                        display: true, 
                        text: 'Land Value at Exit',
                        font: { size: 11, family: "'Roboto', sans-serif" },
                        color: ChartColors.navy
                    },
                    ticks: {
                        font: { size: 10 },
                        maxRotation: 0
                    }
                },
                y: { 
                    ...defaultOptions.scales.y, 
                    stacked: true,
                    min: 0,
                    max: 400,
                    ticks: { 
                        callback: (v) => '+' + v + '%',
                        stepSize: 50
                    }, 
                    title: { 
                        display: true, 
                        text: 'Your Total Return',
                        font: { size: 11, family: "'Roboto', sans-serif" },
                        color: ChartColors.navy
                    } 
                }
            }
        }
    });
}

/**
 * Miami Real Estate Index Chart (MIXRNSA)
 * Shows the S&P/Case-Shiller Miami Home Price Index from 2010-2025
 */
function createMiamiIndexChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    // Key data points from MIXRNSA.csv (semi-annual for cleaner display, 2010-2025)
    const indexData = [
        { date: '2010', value: 148 },
        { date: '2011', value: 137 },
        { date: '2012', value: 146 },
        { date: '2013', value: 167 },
        { date: '2014', value: 179 },  // Una buyout year
        { date: '2015', value: 201 },
        { date: '2016', value: 215 },
        { date: '2017', value: 226 },
        { date: '2018', value: 237 },
        { date: '2019', value: 244 },
        { date: '2020', value: 257 },
        { date: '2021', value: 311 },
        { date: '2022-Q2', value: 404 },  // Citadel deal
        { date: '2022-Q4', value: 398 },
        { date: '2023', value: 417 },
        { date: '2024', value: 443 },
        { date: '2025', value: 436 }
    ];
    
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: indexData.map(d => d.date),
            datasets: [{
                label: 'Miami Home Price Index',
                data: indexData.map(d => d.value),
                borderColor: ChartColors.teal,
                backgroundColor: 'rgba(0, 168, 150, 0.1)',
                fill: true,
                borderWidth: 3,
                tension: 0.3,
                pointRadius: 3,
                pointBackgroundColor: ChartColors.teal,
                pointBorderColor: ChartColors.white,
                pointBorderWidth: 2
            }]
        },
        options: {
            ...defaultOptions,
            plugins: {
                ...defaultOptions.plugins,
                legend: { display: false },
                tooltip: {
                    ...defaultOptions.plugins.tooltip,
                    callbacks: {
                        label: (ctx) => `Index: ${ctx.raw.toFixed(0)} (${((ctx.raw / 148 - 1) * 100).toFixed(0)}% from 2010)`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { 
                        font: { size: 10 },
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    min: 120,
                    max: 480,
                    ticks: {
                        stepSize: 60,
                        callback: (v) => v.toFixed(0)
                    },
                    title: {
                        display: true,
                        text: 'Index Value',
                        font: { size: 11, family: "'Roboto', sans-serif" },
                        color: ChartColors.navy
                    }
                }
            }
        }
    });
}

/**
 * Implied Value Distribution (shows variance in valuations)
 */
function createImpliedValueDistributionChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    const sales = realSalesData.recentSales;
    const impliedValues = sales.map(s => s.implied);
    
    // Group into buckets
    const buckets = {
        '150-175': impliedValues.filter(v => v >= 150 && v < 175).length,
        '175-200': impliedValues.filter(v => v >= 175 && v < 200).length,
        '200-225': impliedValues.filter(v => v >= 200 && v < 225).length,
        '225-250': impliedValues.filter(v => v >= 225 && v < 250).length,
        '250-275': impliedValues.filter(v => v >= 250 && v < 275).length,
        '275-300': impliedValues.filter(v => v >= 275 && v <= 300).length
    };
    
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['$150-175M', '$175-200M', '$200-225M', '$225-250M', '$250-275M', '$275-300M'],
            datasets: [{
                label: 'Number of Sales',
                data: Object.values(buckets),
                backgroundColor: ChartColors.teal,
                borderRadius: 4
            }]
        },
        options: {
            ...defaultOptions,
            plugins: { 
                ...defaultOptions.plugins, 
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Wide variance in implied valuations (2024-2025)',
                    font: { size: 11, weight: 'normal' },
                    color: '#666'
                }
            },
            scales: {
                ...defaultOptions.scales,
                y: { 
                    ...defaultOptions.scales.y, 
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}

/**
 * Interactive Implied Valuation Explorer
 * Allows filtering by bedroom count to see how different units imply different building values
 */

// Complete real sales data for the explorer (sorted chronologically oldest to newest)
const explorerSalesData = [
    // 2024 sales
    { unit: '#11K', date: '2024-01-31', beds: 1, sqft: 886, price: 490000, pricePerSqft: 553, implied: 235 },
    { unit: '#19C', date: '2024-04-02', beds: 1, sqft: 886, price: 500000, pricePerSqft: 564, implied: 240 },
    { unit: '#6S', date: '2024-04-05', beds: 2, sqft: 1188, price: 717800, pricePerSqft: 604, implied: 259 },
    { unit: '#5S', date: '2024-04-30', beds: 2, sqft: 1188, price: 782500, pricePerSqft: 659, implied: 282 },
    { unit: '#17R', date: '2024-05-09', beds: 1, sqft: 886, price: 480000, pricePerSqft: 542, implied: 233 },
    { unit: '#6P', date: '2024-05-15', beds: 1, sqft: 832, price: 520000, pricePerSqft: 625, implied: 253 },
    { unit: '#6T', date: '2024-05-16', beds: 1, sqft: 832, price: 527000, pricePerSqft: 633, implied: 253 },
    { unit: '#9A', date: '2024-06-14', beds: 2, sqft: 1305, price: 685000, pricePerSqft: 525, implied: 219 },
    // 2025 sales
    { unit: '#18R', date: '2025-03-07', beds: 1, sqft: 886, price: 485000, pricePerSqft: 547, implied: 236 },
    { unit: '#18N', date: '2025-03-10', beds: 1, sqft: 1012, price: 516000, pricePerSqft: 510, implied: 215 },
    { unit: '#4J', date: '2025-03-10', beds: 3, sqft: 1703, price: 1150000, pricePerSqft: 675, implied: 290 },
    { unit: '#PHK', date: '2025-04-21', beds: 1, sqft: 886, price: 505000, pricePerSqft: 570, implied: 243 },
    { unit: '#12R', date: '2025-05-21', beds: 1, sqft: 886, price: 360000, pricePerSqft: 406, implied: 175 },
    { unit: '#4L', date: '2025-07-11', beds: 2, sqft: 1188, price: 615000, pricePerSqft: 518, implied: 222 },
    { unit: '#17G', date: '2025-08-05', beds: 2, sqft: 1357, price: 610000, pricePerSqft: 450, implied: 200 },
    { unit: '#20N', date: '2025-08-22', beds: 1, sqft: 1012, price: 470000, pricePerSqft: 464, implied: 195 },
    { unit: '#20H', date: '2025-09-10', beds: 2, sqft: 1188, price: 687500, pricePerSqft: 579, implied: 248 },
    { unit: '#3E', date: '2025-09-19', beds: 2, sqft: 1188, price: 615000, pricePerSqft: 518, implied: 222 },
    { unit: '#5E', date: '2025-10-03', beds: 3, sqft: 2189, price: 1400000, pricePerSqft: 640, implied: 272 },
    { unit: '#10S', date: '2025-10-20', beds: 2, sqft: 1188, price: 475000, pricePerSqft: 400, implied: 171 },
    { unit: '#16K', date: '2025-10-27', beds: 1, sqft: 886, price: 440000, pricePerSqft: 497, implied: 211 },
    { unit: '#5G', date: '2025-10-31', beds: 2, sqft: 1357, price: 485000, pricePerSqft: 357, implied: 159 },
    // 2026 sale
    { unit: '#6N', date: '2026-01-20', beds: 1, sqft: 1012, price: 425000, pricePerSqft: 420, implied: 177 }
];

let explorerChart = null;
let currentFilter = 'all';
let currentSortedData = []; // Store current sorted data for tooltip access

// Format date for chart label (e.g., "1/24" for Jan 2024)
const formatDateLabel = (dateStr) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
};

function getFilteredData(filter) {
    if (filter === 'all') return explorerSalesData;
    return explorerSalesData.filter(s => s.beds === parseInt(filter));
}

function calculateStats(data) {
    if (data.length === 0) return null;
    const implied = data.map(d => d.implied);
    const prices = data.map(d => d.price);
    const pricesPerSqft = data.map(d => d.pricePerSqft);
    
    return {
        count: data.length,
        avgImplied: Math.round(implied.reduce((a, b) => a + b, 0) / implied.length),
        minImplied: Math.min(...implied),
        maxImplied: Math.max(...implied),
        avgPricePerSqft: Math.round(pricesPerSqft.reduce((a, b) => a + b, 0) / pricesPerSqft.length),
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices)
    };
}

// Calculate dynamic Y-axis range based on data with nice padding
function getYAxisRange(data) {
    const implied = data.map(d => d.implied);
    const min = Math.min(...implied);
    const max = Math.max(...implied);
    const range = max - min;
    const padding = Math.max(range * 0.15, 20); // At least 20M padding
    
    // Round to nice numbers
    const yMin = Math.floor((min - padding) / 10) * 10;
    const yMax = Math.ceil((max + padding) / 10) * 10;
    const stepSize = Math.ceil((yMax - yMin) / 5 / 10) * 10; // ~5 ticks
    
    return { min: Math.max(yMin, 0), max: yMax, stepSize };
}

function createExplorerChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    const data = getFilteredData(currentFilter);
    // Sort chronologically by date (oldest to newest)
    currentSortedData = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
    const yRange = getYAxisRange(currentSortedData);
    
    explorerChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: currentSortedData.map(d => `${d.unit}\n${formatDateLabel(d.date)}`),
            datasets: [{
                label: 'Implied Building Value ($M)',
                data: currentSortedData.map(d => d.implied),
                backgroundColor: currentSortedData.map(d => {
                    if (d.implied >= 250) return ChartColors.gold;
                    if (d.implied >= 200) return ChartColors.teal;
                    return ChartColors.navy;
                }),
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: ChartColors.navy,
                    titleFont: { family: "'Montserrat', sans-serif", weight: 'bold' },
                    bodyFont: { family: "'Roboto', sans-serif" },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        title: (ctx) => {
                            const sale = currentSortedData[ctx[0].dataIndex];
                            return `Unit ${sale.unit}`;
                        },
                        label: (ctx) => {
                            const sale = currentSortedData[ctx.dataIndex];
                            return [
                                `Implied Value: $${sale.implied}M`,
                                `Sale Price: $${sale.price.toLocaleString()}`,
                                `${sale.beds}BR, ${sale.sqft.toLocaleString()} sf`,
                                `$${sale.pricePerSqft}/sf`,
                                `Date: ${sale.date}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { 
                        font: { size: 9 }, 
                        maxRotation: 60, 
                        minRotation: 60,
                        autoSkip: false
                    }
                },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    min: yRange.min,
                    max: yRange.max,
                    ticks: { 
                        callback: (v) => '$' + v + 'M',
                        stepSize: yRange.stepSize
                    }
                }
            }
        }
    });
    
    return explorerChart;
}

function updateExplorerChart(filter) {
    if (!explorerChart) return;
    
    currentFilter = filter;
    const data = getFilteredData(filter);
    // Sort chronologically by date (oldest to newest) and update module-level variable
    currentSortedData = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
    const yRange = getYAxisRange(currentSortedData);
    
    explorerChart.data.labels = currentSortedData.map(d => `${d.unit}\n${formatDateLabel(d.date)}`);
    explorerChart.data.datasets[0].data = currentSortedData.map(d => d.implied);
    explorerChart.data.datasets[0].backgroundColor = currentSortedData.map(d => {
        if (d.implied >= 250) return ChartColors.gold;
        if (d.implied >= 200) return ChartColors.teal;
        return ChartColors.navy;
    });
    
    // Update Y-axis scale for filtered data
    explorerChart.options.scales.y.min = yRange.min;
    explorerChart.options.scales.y.max = yRange.max;
    explorerChart.options.scales.y.ticks.stepSize = yRange.stepSize;
    
    explorerChart.update('active');
    
    // Update stats
    const stats = calculateStats(data);
    updateExplorerStats(filter, stats);
    updateSalesTable(filter);
}

function updateExplorerStats(filter, stats) {
    const unitTypeEl = document.getElementById('statUnitType');
    const avgValueEl = document.getElementById('statAvgValue');
    const rangeEl = document.getElementById('statRange');
    const pricePerSqftEl = document.getElementById('statPricePerSqft');
    const entryPriceEl = document.getElementById('statEntryPrice');
    const insightEl = document.getElementById('statInsight');
    
    if (!stats) return;
    
    const typeNames = { 'all': 'All Units', '1': '1 Bedroom', '2': '2 Bedroom', '3': '3 Bedroom' };
    
    if (unitTypeEl) unitTypeEl.textContent = typeNames[filter];
    if (avgValueEl) avgValueEl.textContent = `$${stats.avgImplied}M`;
    if (rangeEl) rangeEl.textContent = `$${stats.minImplied}M - $${stats.maxImplied}M`;
    if (pricePerSqftEl) pricePerSqftEl.textContent = `$${stats.avgPricePerSqft}`;
    if (entryPriceEl) entryPriceEl.textContent = `$${(stats.minPrice/1000).toFixed(0)}K - $${stats.maxPrice >= 1000000 ? (stats.maxPrice/1000000).toFixed(1) + 'M' : (stats.maxPrice/1000).toFixed(0) + 'K'}`;
    
    const insights = {
        'all': 'Smaller units offer lower entry points with similar upside potential when the building is sold.',
        '1': '1BR units offer the lowest entry cost ($360K-$530K) while still capturing the full building upside. Best for capital-efficient investors.',
        '2': '2BR units show the widest valuation variance ($159M-$282M implied). Opportunity to find undervalued units in this segment.',
        '3': '3BR units command premium prices but imply highest building values ($272M-$290M). Best for investors seeking larger ownership stakes.'
    };
    if (insightEl) insightEl.textContent = insights[filter];
}

function updateSalesTable(filter) {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) return;
    
    const data = getFilteredData(filter);
    const sortedData = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
    const visibleRows = 5; // Show first 5 rows by default
    
    tbody.innerHTML = sortedData.map((sale, index) => {
        const impliedClass = sale.implied >= 250 ? 'implied-high' : (sale.implied < 180 ? 'implied-low' : 'implied-mid');
        const hiddenClass = index >= visibleRows ? 'hidden-row' : '';
        return `
            <tr data-beds="${sale.beds}" class="${hiddenClass}">
                <td><strong>${sale.unit}</strong></td>
                <td>${sale.date}</td>
                <td>${sale.beds}BR</td>
                <td>${sale.sqft.toLocaleString()}</td>
                <td>$${sale.price.toLocaleString()}</td>
                <td>$${sale.pricePerSqft}</td>
                <td class="${impliedClass}">$${sale.implied}M</td>
            </tr>
        `;
    }).join('');
    
    // Update show more button visibility and text
    const showMoreBtn = document.getElementById('showMoreSalesBtn');
    if (showMoreBtn) {
        const hiddenCount = sortedData.length - visibleRows;
        if (hiddenCount > 0) {
            showMoreBtn.style.display = 'inline-flex';
            showMoreBtn.innerHTML = `<span>Show ${hiddenCount} More</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            showMoreBtn.dataset.expanded = 'false';
        } else {
            showMoreBtn.style.display = 'none';
        }
    }
}

function toggleSalesTable() {
    const tbody = document.getElementById('salesTableBody');
    const showMoreBtn = document.getElementById('showMoreSalesBtn');
    if (!tbody || !showMoreBtn) return;
    
    const isExpanded = showMoreBtn.dataset.expanded === 'true';
    const hiddenRows = tbody.querySelectorAll('.hidden-row');
    
    if (isExpanded) {
        // Collapse - hide rows again
        hiddenRows.forEach(row => row.style.display = 'none');
        showMoreBtn.innerHTML = `<span>Show ${hiddenRows.length} More</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        showMoreBtn.dataset.expanded = 'false';
    } else {
        // Expand - show all rows (use table-row to override CSS hidden-row rule)
        hiddenRows.forEach(row => row.style.display = 'table-row');
        showMoreBtn.innerHTML = `<span>Show Less</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
        showMoreBtn.dataset.expanded = 'true';
    }
}

// Toggle between Sales and Rentals data views
function toggleDataView(view) {
    const salesContainer = document.getElementById('salesTableContainer');
    const rentalsContainer = document.getElementById('rentalsTableContainer');
    const toggleBtns = document.querySelectorAll('.data-toggle-btn');
    
    if (!salesContainer || !rentalsContainer) return;
    
    // Update button states
    toggleBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    if (view === 'sales') {
        salesContainer.style.display = 'block';
        rentalsContainer.style.display = 'none';
    } else {
        salesContainer.style.display = 'none';
        rentalsContainer.style.display = 'block';
        // Populate rentals table if not already done
        updateRentalsTable();
    }
}

// Update rentals table with data
function updateRentalsTable() {
    const tbody = document.getElementById('rentalsTableBody');
    if (!tbody) return;
    
    // Sort by date descending
    const sortedData = [...rawRentalData].sort((a, b) => new Date(b.date) - new Date(a.date));
    const visibleRows = 5;
    
    tbody.innerHTML = sortedData.map((rental, index) => {
        const psfRent = (rental.price / rental.sqft).toFixed(2);
        const hiddenClass = index >= visibleRows ? 'hidden-row' : '';
        
        return `
            <tr data-beds="${rental.beds}" class="${hiddenClass}">
                <td><strong>${rental.unit}</strong></td>
                <td>${rental.date}</td>
                <td>${rental.beds}BR</td>
                <td>${rental.sqft.toLocaleString()}</td>
                <td>$${rental.price.toLocaleString()}</td>
                <td>$${psfRent}</td>
            </tr>
        `;
    }).join('');
    
    // Update show more button
    const showMoreBtn = document.getElementById('showMoreRentalsBtn');
    if (showMoreBtn) {
        const hiddenCount = sortedData.length - visibleRows;
        if (hiddenCount > 0) {
            showMoreBtn.style.display = 'inline-flex';
            showMoreBtn.innerHTML = `<span>Show ${hiddenCount} More</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            showMoreBtn.dataset.expanded = 'false';
        } else {
            showMoreBtn.style.display = 'none';
        }
    }
}

// Toggle rentals table expand/collapse
function toggleRentalsTable() {
    const tbody = document.getElementById('rentalsTableBody');
    const showMoreBtn = document.getElementById('showMoreRentalsBtn');
    if (!tbody || !showMoreBtn) return;
    
    const isExpanded = showMoreBtn.dataset.expanded === 'true';
    const hiddenRows = tbody.querySelectorAll('.hidden-row');
    
    if (isExpanded) {
        hiddenRows.forEach(row => row.style.display = 'none');
        showMoreBtn.innerHTML = `<span>Show ${hiddenRows.length} More</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        showMoreBtn.dataset.expanded = 'false';
    } else {
        hiddenRows.forEach(row => row.style.display = 'table-row');
        showMoreBtn.innerHTML = `<span>Show Less</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
        showMoreBtn.dataset.expanded = 'true';
    }
}

function initExplorerFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateExplorerChart(btn.dataset.filter);
        });
    });
}

/**
 * Investment Simulator
 * Comprehensive cashflow modeling, IRR, MOIC, and NAV projections
 */

// Unit ownership percentages and 2026 monthly HOA (from condo documents)
const unitOwnershipData = {
    // Standard units (same ownership % regardless of floor)
    'A': { ownership: 0.31222800, sqft: 1305, beds: 2, hoa: 1369 },
    'B': { ownership: 0.27753600, sqft: 1188, beds: 2, hoa: 1217 },
    'C': { ownership: 0.20815200, sqft: 886, beds: 1, hoa: 913 },
    'D': { ownership: 0.39641400, sqft: 1703, beds: 3, hoa: 1739 },
    'E': { ownership: 0.27753600, sqft: 1188, beds: 2, hoa: 1217 },
    'F': { ownership: 0.23474900, sqft: 1012, beds: 1, hoa: 1030 },
    'G': { ownership: 0.30529000, sqft: 1357, beds: 2, hoa: 1339 },
    'H': { ownership: 0.27753600, sqft: 1188, beds: 2, hoa: 1217 },
    'J': { ownership: 0.39641400, sqft: 1703, beds: 3, hoa: 1739 },
    'K': { ownership: 0.20815200, sqft: 886, beds: 1, hoa: 913 },
    'L': { ownership: 0.27753600, sqft: 1188, beds: 2, hoa: 1217 },
    'M': { ownership: 0.30945300, sqft: 1357, beds: 2, hoa: 1357 },
    'N': { ownership: 0.24053100, sqft: 1012, beds: 1, hoa: 1055 },
    'P': { ownership: 0.20583900, sqft: 832, beds: 1, hoa: 903 },
    'R': { ownership: 0.20583900, sqft: 886, beds: 1, hoa: 903 },
    'S': { ownership: 0.27753600, sqft: 1188, beds: 2, hoa: 1217 },
    'T': { ownership: 0.20815200, sqft: 832, beds: 1, hoa: 913 },
    'U': { ownership: 0.24053100, sqft: 1012, beds: 1, hoa: 1055 },
    // Special units (specific floor/unit combinations)
    '12E&F': { ownership: 0.51529200, sqft: 2189, beds: 3, hoa: 2260 },
    '19E&F': { ownership: 0.51529200, sqft: 2189, beds: 3, hoa: 2260 },
    '19G&H': { ownership: 0.58513900, sqft: 2500, beds: 3, hoa: 2567 },
    '16D': { ownership: 0.46441100, sqft: 1900, beds: 3, hoa: 2037 },
    '16E': { ownership: 0.21002000, sqft: 900, beds: 1, hoa: 921 },
    '21H': { ownership: 0.20445200, sqft: 886, beds: 1, hoa: 897 },
    '21J': { ownership: 0.47019300, sqft: 2000, beds: 3, hoa: 2062 },
    '1A': { ownership: 0.37223610, sqft: 1500, beds: 2, hoa: 1633 },
    '1B': { ownership: 0.28817500, sqft: 1200, beds: 2, hoa: 1264 },
    'A1': { ownership: 0.36311000, sqft: 1450, beds: 2, hoa: 1593 },
    'B1': { ownership: 0.37152300, sqft: 1500, beds: 2, hoa: 1630 },
    'B2': { ownership: 0.39308900, sqft: 1600, beds: 2, hoa: 1724 },
    'C1': { ownership: 0.14339400, sqft: 600, beds: 1, hoa: 629 },
    'C2': { ownership: 1.72674800, sqft: 7000, beds: 4, hoa: 7574 },
    'C3': { ownership: 0.17461700, sqft: 750, beds: 1, hoa: 766 }
};

const LAND_VALUE = 615000000; // $615M base land value

// Raw rental data (from public records 2022-2026)
const rawRentalData = [
    // 2026
    { unit: '#16U', date: '2026-01-31', price: 2750, beds: 1, sqft: 998 },
    { unit: '#18C', date: '2026-01-08', price: 3200, beds: 1, sqft: 886 },
    // 2025
    { unit: '#11L', date: '2025-11-30', price: 3000, beds: 2, sqft: 1188 },
    { unit: '#18U', date: '2025-11-30', price: 2650, beds: 1, sqft: 998 },
    { unit: '#9C', date: '2025-11-25', price: 2750, beds: 1, sqft: 886 },
    { unit: '#16K', date: '2025-11-23', price: 2750, beds: 1, sqft: 886 },
    { unit: '#16S', date: '2025-11-20', price: 4500, beds: 2, sqft: 1188 },
    { unit: '#11S', date: '2025-11-18', price: 3800, beds: 2, sqft: 1188 },
    { unit: '#7P', date: '2025-10-31', price: 2900, beds: 1, sqft: 832 },
    { unit: '#3E', date: '2025-10-05', price: 4200, beds: 2, sqft: 1188 },
    { unit: '#4L', date: '2025-09-24', price: 4000, beds: 2, sqft: 1188 },
    { unit: '#3L', date: '2025-09-23', price: 3100, beds: 2, sqft: 1188 },
    { unit: '#7L', date: '2025-09-14', price: 3000, beds: 2, sqft: 1188 },
    { unit: '#20T', date: '2025-08-25', price: 3450, beds: 1, sqft: 832 },
    { unit: '#12B', date: '2025-08-14', price: 4200, beds: 2, sqft: 1188 },
    { unit: '#10P', date: '2025-08-14', price: 2600, beds: 1, sqft: 832 },
    { unit: '#17U', date: '2025-07-31', price: 3000, beds: 1, sqft: 998 },
    { unit: '#20B', date: '2025-07-28', price: 4000, beds: 2, sqft: 1188 },
    { unit: '#5J', date: '2025-07-25', price: 6300, beds: 3, sqft: 1703 },
    { unit: '#20M', date: '2025-07-24', price: 4150, beds: 2, sqft: 1344 },
    { unit: '#2F', date: '2025-07-09', price: 3100, beds: 1, sqft: 1001 },
    { unit: '#21H', date: '2025-06-30', price: 4150, beds: 2, sqft: 1188 },
    { unit: '#4P', date: '2025-06-09', price: 2500, beds: 1, sqft: 832 },
    { unit: '#6H', date: '2025-05-31', price: 4400, beds: 2, sqft: 1188 },
    { unit: '#6D', date: '2025-05-31', price: 6550, beds: 3, sqft: 1703 },
    { unit: '#PHC', date: '2025-05-14', price: 3150, beds: 1, sqft: 886 },
    { unit: '#21K', date: '2025-05-12', price: 2900, beds: 1, sqft: 886 },
    { unit: '#14F', date: '2025-05-05', price: 3000, beds: 1, sqft: 1001 },
    { unit: '#18N', date: '2025-04-30', price: 2800, beds: 1, sqft: 1012 },
    { unit: '#18R', date: '2025-04-23', price: 2800, beds: 1, sqft: 886 },
    { unit: '#4U', date: '2025-03-31', price: 3300, beds: 1, sqft: 998 },
    { unit: '#18S', date: '2025-03-31', price: 3700, beds: 2, sqft: 1188 },
    { unit: '#20P', date: '2025-03-30', price: 2500, beds: 1, sqft: 832 },
    { unit: '#2T', date: '2025-03-29', price: 3000, beds: 1, sqft: 832 },
    { unit: '#9K', date: '2025-03-18', price: 2700, beds: 1, sqft: 886 },
    { unit: '#16H', date: '2025-02-28', price: 4000, beds: 2, sqft: 1188 },
    { unit: '#19A', date: '2025-02-28', price: 4000, beds: 2, sqft: 1305 },
    { unit: '#11N', date: '2025-02-26', price: 2600, beds: 1, sqft: 1012 },
    { unit: '#18T', date: '2025-02-23', price: 3200, beds: 1, sqft: 832 },
    { unit: '#17S', date: '2025-02-17', price: 3590, beds: 2, sqft: 1188 },
    { unit: '#11G', date: '2025-02-10', price: 4600, beds: 2, sqft: 1357 },
    { unit: '#6E', date: '2025-02-02', price: 3700, beds: 2, sqft: 1188 },
    // 2024
    { unit: '#17R', date: '2024-12-30', price: 2800, beds: 1, sqft: 886 },
    { unit: '#5B', date: '2024-12-05', price: 3150, beds: 2, sqft: 1188 },
    { unit: '#19P', date: '2024-11-30', price: 2525, beds: 1, sqft: 832 },
    { unit: '#9B', date: '2024-11-10', price: 3550, beds: 2, sqft: 1188 },
    { unit: '#21E', date: '2024-11-03', price: 3500, beds: 2, sqft: 1188 },
    { unit: '#9M', date: '2024-10-30', price: 3600, beds: 2, sqft: 1344 },
    { unit: '#PHK', date: '2024-10-28', price: 2800, beds: 1, sqft: 886 },
    { unit: '#11T', date: '2024-10-17', price: 3200, beds: 1, sqft: 832 },
    { unit: '#18H', date: '2024-10-14', price: 3850, beds: 2, sqft: 1188 },
    { unit: '#16B', date: '2024-09-25', price: 3950, beds: 2, sqft: 1188 },
    { unit: '#5L', date: '2024-08-31', price: 3300, beds: 2, sqft: 1188 },
    { unit: '#21F', date: '2024-07-31', price: 3300, beds: 1, sqft: 1001 },
    { unit: '#11E', date: '2024-06-20', price: 4100, beds: 2, sqft: 1188 },
    { unit: '#6P', date: '2024-06-03', price: 3100, beds: 1, sqft: 832 },
    { unit: '#3A', date: '2024-06-02', price: 4000, beds: 2, sqft: 1305 },
    { unit: '#21C', date: '2024-05-07', price: 2900, beds: 1, sqft: 886 },
    { unit: '#8B', date: '2024-04-08', price: 3200, beds: 2, sqft: 1188 },
    { unit: '#2B', date: '2024-04-02', price: 3250, beds: 2, sqft: 1188 },
    { unit: '#4B', date: '2024-03-31', price: 3700, beds: 2, sqft: 1188 },
    { unit: '#18F', date: '2024-03-05', price: 3650, beds: 1, sqft: 1001 },
    { unit: '#9L', date: '2024-02-29', price: 3200, beds: 2, sqft: 1188 },
    { unit: '#4T', date: '2024-01-26', price: 2400, beds: 1, sqft: 832 },
    { unit: '#17C', date: '2024-01-21', price: 2600, beds: 1, sqft: 886 },
    // 2023
    { unit: '#3N', date: '2023-11-30', price: 2650, beds: 1, sqft: 1012 },
    { unit: '#7E', date: '2023-11-16', price: 3650, beds: 2, sqft: 1188 },
    { unit: '#8E', date: '2023-11-12', price: 3500, beds: 2, sqft: 1188 },
    { unit: '#5S', date: '2023-09-28', price: 4000, beds: 2, sqft: 1188 },
    { unit: '#10U', date: '2023-09-27', price: 2700, beds: 1, sqft: 998 },
    { unit: '#21J', date: '2023-08-27', price: 6500, beds: 3, sqft: 1703 },
    { unit: '#17H', date: '2023-08-14', price: 3800, beds: 2, sqft: 1188 },
    { unit: '#10C', date: '2023-06-30', price: 3050, beds: 1, sqft: 886 },
    { unit: '#6T', date: '2023-06-29', price: 3250, beds: 1, sqft: 832 },
    { unit: '#4R', date: '2023-06-11', price: 2600, beds: 1, sqft: 886 },
    { unit: '#11R', date: '2023-05-14', price: 3000, beds: 1, sqft: 886 },
    { unit: '#3S', date: '2023-05-04', price: 3400, beds: 2, sqft: 1188 },
    { unit: '#2G', date: '2023-03-31', price: 3300, beds: 2, sqft: 1357 },
    { unit: '#10K', date: '2023-03-02', price: 2700, beds: 1, sqft: 886 },
    { unit: '#8S', date: '2023-02-28', price: 2900, beds: 2, sqft: 1188 },
    { unit: '#18A', date: '2023-02-19', price: 3550, beds: 2, sqft: 1305 },
    { unit: '#6S', date: '2023-02-14', price: 3500, beds: 2, sqft: 1188 },
    { unit: '#3U', date: '2023-01-08', price: 3000, beds: 1, sqft: 998 },
    // 2022
    { unit: '#19L', date: '2022-11-30', price: 3100, beds: 2, sqft: 1188 },
    { unit: '#4E', date: '2022-10-24', price: 4000, beds: 2, sqft: 1188 },
    { unit: '#12G', date: '2022-10-16', price: 4350, beds: 2, sqft: 1357 },
    { unit: '#22C', date: '2022-10-16', price: 2950, beds: 1, sqft: 886 },
    { unit: '#7N', date: '2022-09-29', price: 2650, beds: 1, sqft: 1012 },
    { unit: '#19C', date: '2022-07-14', price: 2750, beds: 1, sqft: 886 },
    { unit: '#20J', date: '2022-07-08', price: 5500, beds: 3, sqft: 1703 },
    { unit: '#10R', date: '2022-06-29', price: 2700, beds: 1, sqft: 886 },
    { unit: '#9H', date: '2022-04-05', price: 4000, beds: 2, sqft: 1188 }
];

// Track which years are selected for filtering
let selectedRentalYears = [2024, 2025, 2026];

// Calculate rental stats from filtered data
function calculateRentalStats(years) {
    const filtered = rawRentalData.filter(r => {
        const year = parseInt(r.date.substring(0, 4));
        return years.includes(year);
    });
    
    if (filtered.length === 0) {
        return { byBedroom: {}, bySqftRange: {}, count: 0 };
    }
    
    // By bedroom
    const byBedroom = {};
    [1, 2, 3].forEach(beds => {
        const subset = filtered.filter(r => r.beds === beds);
        if (subset.length > 0) {
            const prices = subset.map(r => r.price);
            const sqfts = subset.map(r => r.sqft);
            byBedroom[beds] = {
                count: subset.length,
                avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
                min: Math.min(...prices),
                max: Math.max(...prices),
                avgSqft: Math.round(sqfts.reduce((a, b) => a + b, 0) / sqfts.length),
                avgPsf: Math.round((prices.reduce((a, b) => a + b, 0) / sqfts.reduce((a, b) => a + b, 0)) * 100) / 100
            };
        }
    });
    
    // By sqft range
    const bySqftRange = {};
    const ranges = [
        ['800-900', 800, 900],
        ['900-1050', 900, 1050],
        ['1050-1200', 1050, 1200],
        ['1200-1400', 1200, 1400],
        ['1400-1800', 1400, 1800]
    ];
    ranges.forEach(([label, min, max]) => {
        const subset = filtered.filter(r => r.sqft >= min && r.sqft < max);
        if (subset.length > 0) {
            const prices = subset.map(r => r.price);
            bySqftRange[label] = {
                count: subset.length,
                avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
                min: Math.min(...prices),
                max: Math.max(...prices)
            };
        } else {
            bySqftRange[label] = { count: 0, avg: 0, min: 0, max: 0 };
        }
    });
    // Extrapolated for larger units
    bySqftRange['1800+'] = { count: 0, avg: 7500, min: 7000, max: 8500 };
    
    return { byBedroom, bySqftRange, count: filtered.length };
}

// Get current rental market data based on selected years
function getRentalMarketData() {
    return calculateRentalStats(selectedRentalYears);
}

// Chart instance for rent by beds
let rentByBedsChartInstance = null;

// Get rent estimate for a unit based on sqft and beds
function getRentEstimate(sqft, beds) {
    const rentalData = getRentalMarketData();
    
    // First try sqft-based estimate (more accurate)
    let sqftRange = null;
    if (sqft < 900) sqftRange = '800-900';
    else if (sqft < 1050) sqftRange = '900-1050';
    else if (sqft < 1200) sqftRange = '1050-1200';
    else if (sqft < 1400) sqftRange = '1200-1400';
    else if (sqft < 1800) sqftRange = '1400-1800';
    else sqftRange = '1800+';
    
    const sqftData = rentalData.bySqftRange[sqftRange];
    const bedsData = rentalData.byBedroom[beds];
    
    // Blend sqft-based and bedroom-based estimates
    if (sqftData && sqftData.count > 0) {
        return {
            min: sqftData.min,
            max: sqftData.max,
            avg: sqftData.avg,
            source: `${sqftData.count} rentals (${sqftRange} sqft)`
        };
    } else if (bedsData) {
        return {
            min: bedsData.min,
            max: bedsData.max,
            avg: bedsData.avg,
            source: `${bedsData.count} ${beds}BR rentals`
        };
    }
    
    // Fallback: estimate based on $3.20/sqft avg
    const estimated = Math.round(sqft * 3.20);
    return {
        min: Math.round(estimated * 0.85),
        max: Math.round(estimated * 1.15),
        avg: estimated,
        source: 'estimated at ~$3.20/sqft'
    };
}

// Update rental market insights UI based on selected years
function updateRentalMarketUI() {
    const stats = getRentalMarketData();
    
    // Update the summary table
    const tableRows = {
        1: document.getElementById('rental1brRow'),
        2: document.getElementById('rental2brRow'),
        3: document.getElementById('rental3brRow')
    };
    
    [1, 2, 3].forEach(beds => {
        const row = tableRows[beds];
        if (!row) return;
        
        const data = stats.byBedroom[beds];
        if (data && data.count > 0) {
            row.querySelector('.rent-avg').textContent = `$${data.avg.toLocaleString()}/mo`;
            row.querySelector('.rent-range').textContent = `$${data.min.toLocaleString()} - $${data.max.toLocaleString()}`;
            row.querySelector('.rent-psf').textContent = `$${data.avgPsf.toFixed(2)}`;
            row.style.opacity = '1';
        } else {
            row.querySelector('.rent-avg').textContent = 'N/A';
            row.querySelector('.rent-range').textContent = 'No data';
            row.querySelector('.rent-psf').textContent = '-';
            row.style.opacity = '0.5';
        }
    });
    
    // Update total count
    const countEl = document.getElementById('rentalDataCount');
    if (countEl) {
        countEl.textContent = `${stats.count} rentals`;
    }
    
    // Update chart
    updateRentByBedsChart();
    
    // Update calculator rent estimate if unit selected
    updateRentEstimate();
}

// Update the rent by beds chart with current filter
function updateRentByBedsChart() {
    const stats = getRentalMarketData();
    
    if (!rentByBedsChartInstance) return;
    
    const data = stats.byBedroom;
    
    // Update range bars
    rentByBedsChartInstance.data.datasets[0].data = [
        data[1] && data[1].count > 0 ? [data[1].min, data[1].max] : [0, 0],
        data[2] && data[2].count > 0 ? [data[2].min, data[2].max] : [0, 0],
        data[3] && data[3].count > 0 ? [data[3].min, data[3].max] : [0, 0]
    ];
    
    // Update average points
    rentByBedsChartInstance.data.datasets[1].data = [
        data[1] && data[1].count > 0 ? data[1].avg : null,
        data[2] && data[2].count > 0 ? data[2].avg : null,
        data[3] && data[3].count > 0 ? data[3].avg : null
    ];
    
    rentByBedsChartInstance.update();
}

// Toggle a year in the rental filter
function toggleRentalYear(year) {
    const idx = selectedRentalYears.indexOf(year);
    if (idx > -1) {
        // Don't allow removing all years
        if (selectedRentalYears.length > 1) {
            selectedRentalYears.splice(idx, 1);
        }
    } else {
        selectedRentalYears.push(year);
    }
    selectedRentalYears.sort();
    updateRentalMarketUI();
}

// Initialize rental year filter buttons
function initRentalYearFilters() {
    const buttons = document.querySelectorAll('.rental-year-btn');
    buttons.forEach(btn => {
        const year = parseInt(btn.dataset.year);
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            toggleRentalYear(year);
        });
    });
}

// Update rent estimate display when unit changes
function updateRentEstimate() {
    const unitType = document.getElementById('unitTypeSelect')?.value;
    const rentEstimateEl = document.getElementById('rentEstimate');
    const rentRangeText = document.getElementById('rentRangeText');
    
    if (!rentEstimateEl || !rentRangeText || !unitType) {
        if (rentEstimateEl) rentEstimateEl.style.display = 'none';
        return;
    }
    
    const unitData = unitOwnershipData[unitType];
    if (!unitData) {
        rentEstimateEl.style.display = 'none';
        return;
    }
    
    const estimate = getRentEstimate(unitData.sqft, unitData.beds);
    rentRangeText.textContent = `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()}/mo (avg $${estimate.avg.toLocaleString()})`;
    rentEstimateEl.style.display = 'block';
}

// Cashflow chart instance
let cashflowChartInstance = null;
let currentChartView = 'cashflow';

function formatCurrency(amount) {
    if (Math.abs(amount) >= 1000000000) {
        return '$' + (amount / 1000000000).toFixed(2) + 'B';
    } else if (Math.abs(amount) >= 1000000) {
        return '$' + (amount / 1000000).toFixed(1) + 'M';
    } else if (Math.abs(amount) >= 1000) {
        return '$' + Math.round(amount / 1000).toLocaleString() + 'K';
    }
    return '$' + Math.round(amount).toLocaleString();
}

function formatCurrencyFull(amount) {
    return '$' + Math.round(amount).toLocaleString();
}

// Get HOA from unit data (actual 2026 values)
function getUnitHOA(unitData) {
    return unitData.hoa || 1000; // fallback if not defined
}

// Calculate monthly mortgage payment
function calculateMortgagePayment(principal, annualRate, termYears) {
    if (principal <= 0 || annualRate <= 0) return 0;
    const monthlyRate = annualRate / 12;
    const numPayments = termYears * 12;
    return principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
}

// Calculate remaining loan balance after n payments
function calculateLoanBalance(principal, annualRate, termYears, paymentsComplete) {
    if (principal <= 0 || annualRate <= 0 || paymentsComplete <= 0) return principal;
    const monthlyRate = annualRate / 12;
    const numPayments = termYears * 12;
    const monthlyPayment = calculateMortgagePayment(principal, annualRate, termYears);
    
    let balance = principal;
    for (let i = 0; i < paymentsComplete; i++) {
        const interest = balance * monthlyRate;
        const principalPayment = monthlyPayment - interest;
        balance -= principalPayment;
    }
    return Math.max(0, balance);
}

// Calculate IRR using Newton-Raphson method
function calculateIRR(cashflows, guess = 0.1) {
    const maxIterations = 100;
    const tolerance = 0.0001;
    let rate = guess;
    
    for (let i = 0; i < maxIterations; i++) {
        let npv = 0;
        let derivative = 0;
        
        for (let t = 0; t < cashflows.length; t++) {
            npv += cashflows[t] / Math.pow(1 + rate, t);
            if (t > 0) {
                derivative -= t * cashflows[t] / Math.pow(1 + rate, t + 1);
            }
        }
        
        if (Math.abs(npv) < tolerance) {
            return rate;
        }
        
        if (Math.abs(derivative) < tolerance) {
            break;
        }
        
        rate = rate - npv / derivative;
        
        // Bound the rate to reasonable values
        if (rate < -0.99) rate = -0.99;
        if (rate > 10) rate = 10;
    }
    
    return rate;
}

// Main investment calculation with debt support
function calculateInvestment() {
    const unitType = document.getElementById('unitTypeSelect')?.value;
    const buyPriceRaw = document.getElementById('buyPriceInput')?.value;
    const monthlyRentRaw = document.getElementById('monthlyRentInput')?.value;
    
    const buyPrice = parseFloat((buyPriceRaw || '').replace(/,/g, ''));
    const monthlyRent = parseFloat((monthlyRentRaw || '').replace(/,/g, ''));
    
    const resultsDiv = document.getElementById('calculatorResults');
    const emptyDiv = document.getElementById('calculatorEmpty');
    
    // Check if we have minimum valid inputs
    if (!unitType || !buyPrice || buyPrice <= 0 || !monthlyRent || monthlyRent <= 0) {
        if (resultsDiv) resultsDiv.style.display = 'none';
        if (emptyDiv) emptyDiv.style.display = 'block';
        return;
    }
    
    const unitData = unitOwnershipData[unitType];
    if (!unitData) {
        if (resultsDiv) resultsDiv.style.display = 'none';
        if (emptyDiv) emptyDiv.style.display = 'block';
        return;
    }
    
    // Show results
    if (resultsDiv) resultsDiv.style.display = 'block';
    if (emptyDiv) emptyDiv.style.display = 'none';
    
    // Get assumptions
    const holdPeriod = parseInt(document.getElementById('holdPeriodSelect')?.value || 5);
    const rentGrowth = parseFloat(document.getElementById('rentGrowthInput')?.value || 3) / 100;
    const landGrowth = parseFloat(document.getElementById('landGrowthInput')?.value || 5) / 100;
    const unitGrowth = parseFloat(document.getElementById('unitGrowthInput')?.value || 3) / 100;
    const propTaxRate = parseFloat(document.getElementById('propTaxInput')?.value || 1.41) / 100;
    const expenseGrowth = parseFloat(document.getElementById('expenseGrowthInput')?.value || 2) / 100;
    
    // Financing options (unified: Year 0 = acquisition, Year 2+ = refi)
    const useFinancing = document.getElementById('useFinancing')?.checked || false;
    const financingYear = parseInt(document.getElementById('financingYear')?.value || 0);
    const financingLTV = parseFloat(document.getElementById('financingLTV')?.value || 65) / 100;
    const financingRate = parseFloat(document.getElementById('financingRate')?.value || 7) / 100;
    const financingTerm = parseInt(document.getElementById('financingTerm')?.value || 30);
    
    // Derived flags for compatibility
    const useDebtDay1 = useFinancing && financingYear === 0;
    const useRefi = useFinancing && financingYear > 0;
    const refiYear = financingYear;
    
    // Unit data
    const ownershipPct = unitData.ownership;
    const sqft = unitData.sqft;
    
    // Get actual HOA for unit type (2026 values)
    const monthlyHOA = getUnitHOA(unitData);
    const yearlyHOA = monthlyHOA * 12;
    
    // Property tax (based on buy price)
    const yearlyPropTax = buyPrice * propTaxRate;
    
    // Entry valuation (implied building value)
    const entryValuation = buyPrice / (ownershipPct / 100);
    
    // Initial financing setup
    let initialLoan = 0;
    let initialEquity = buyPrice;
    let monthlyDebtService = 0;
    
    if (useDebtDay1) {
        initialLoan = buyPrice * financingLTV;
        initialEquity = buyPrice - initialLoan;
        monthlyDebtService = calculateMortgagePayment(initialLoan, financingRate, financingTerm);
    }
    
    // Update financing summary
    if (useFinancing) {
        const financingSummary = document.getElementById('financingSummary');
        if (financingSummary) {
            if (useDebtDay1) {
                financingSummary.textContent = `Acquisition Loan: ${formatCurrencyFull(initialLoan)} | Monthly Payment: ${formatCurrencyFull(monthlyDebtService)} | Equity Required: ${formatCurrencyFull(initialEquity)}`;
            } else {
                financingSummary.textContent = `Refi at Year ${refiYear}: Details calculated below`;
            }
        }
    }
    
    // Build cashflow projections
    const yearlyData = [];
    let cumulativeCash = -initialEquity; // Initial equity investment
    const cashflows = [-initialEquity]; // For IRR calculation
    
    let currentRent = monthlyRent * 12;
    let currentHOA = yearlyHOA;
    let currentPropTax = yearlyPropTax;
    let currentLandValue = LAND_VALUE;
    let currentUnitValue = buyPrice;
    
    let currentLoan = initialLoan;
    let currentMonthlyDebt = monthlyDebtService;
    let currentDebtRate = financingRate;
    let currentDebtTerm = financingTerm;
    let paymentsMade = 0;
    let cashOutReceived = 0;
    
    for (let year = 1; year <= holdPeriod; year++) {
        // Apply growth rates
        if (year > 1) {
            currentRent *= (1 + rentGrowth);
            currentHOA *= (1 + expenseGrowth);
            currentPropTax *= (1 + expenseGrowth);
        }
        currentLandValue *= (1 + landGrowth);
        currentUnitValue *= (1 + unitGrowth);
        
        // Check for refinance
        let refiCashOut = 0;
        if (useRefi && year === refiYear) {
            // Calculate loan balance before refi (0 if no prior debt)
            const oldBalance = 0; // No prior debt since refi is standalone
            
            // New loan based on current unit value
            const newLoan = currentUnitValue * financingLTV;
            refiCashOut = newLoan - oldBalance;
            
            // Update debt terms
            currentLoan = newLoan;
            currentDebtRate = financingRate;
            currentDebtTerm = financingTerm;
            currentMonthlyDebt = calculateMortgagePayment(newLoan, financingRate, financingTerm);
            paymentsMade = 0;
            cashOutReceived = refiCashOut;
            
            // Update financing summary for refi
            const financingSummary = document.getElementById('financingSummary');
            if (financingSummary) {
                financingSummary.textContent = `Refi at Year ${refiYear}: New Loan ${formatCurrency(newLoan)} | Cash-Out: ${formatCurrency(refiCashOut)} | Payment: ${formatCurrencyFull(currentMonthlyDebt)}/mo`;
            }
        }
        
        // Annual debt service
        const yearlyDebtService = currentMonthlyDebt * 12;
        paymentsMade += 12;
        
        const totalExpenses = currentHOA + currentPropTax + yearlyDebtService;
        const netCashflow = currentRent - totalExpenses + refiCashOut;
        cumulativeCash += netCashflow;
        
        // Calculate current loan balance
        const loanBalance = currentLoan > 0 ? calculateLoanBalance(currentLoan, currentDebtRate, currentDebtTerm, paymentsMade) : 0;
        
        // NAV calculations
        const landNAV = currentLandValue * (ownershipPct / 100);
        const unitNAV = currentUnitValue;
        const equityNAV = unitNAV - loanBalance;
        
        yearlyData.push({
            year,
            grossRent: currentRent,
            hoa: currentHOA,
            propTax: currentPropTax,
            debtService: yearlyDebtService,
            refiCashOut,
            netCashflow,
            cumulative: cumulativeCash,
            unitNAV,
            landNAV,
            loanBalance,
            equityNAV
        });
        
        // For IRR: add net cashflow, and on final year add exit proceeds
        if (year === holdPeriod) {
            const exitValue = currentLandValue * (ownershipPct / 100);
            const exitProceeds = exitValue - loanBalance; // Exit value minus loan payoff
            cashflows.push(netCashflow - refiCashOut + exitProceeds); // Remove refi cash-out from final year CF (already counted), add exit
        } else {
            cashflows.push(netCashflow);
        }
    }
    
    // Final calculations
    const finalLoanBalance = yearlyData[yearlyData.length - 1].loanBalance;
    const exitLandValue = currentLandValue * (ownershipPct / 100);
    const exitProceeds = exitLandValue - finalLoanBalance;
    const totalCashReceived = cumulativeCash + initialEquity + exitProceeds;
    const totalProfit = totalCashReceived - initialEquity;
    const moic = totalCashReceived / initialEquity;
    const irr = calculateIRR(cashflows);
    
    // Cash-on-Cash (Year 1) - based on equity invested
    const year1Cashflow = yearlyData[0].netCashflow - (yearlyData[0].refiCashOut || 0);
    const cashOnCash = year1Cashflow / initialEquity;
    
    // Update display - Unit Info Bar
    document.getElementById('resultUnitType').textContent = unitType;
    document.getElementById('resultSqft').textContent = sqft.toLocaleString();
    document.getElementById('resultOwnership').textContent = ownershipPct.toFixed(4) + '%';
    document.getElementById('resultHOA').textContent = formatCurrencyFull(monthlyHOA);
    document.getElementById('resultPropTax').textContent = formatCurrencyFull(yearlyPropTax);
    
    // Key Metrics
    document.getElementById('resultMOIC').textContent = moic.toFixed(2) + 'x';
    document.getElementById('resultIRR').textContent = (irr * 100).toFixed(1) + '%';
    document.getElementById('resultCoC').textContent = (cashOnCash * 100).toFixed(1) + '%';
    document.getElementById('resultProfit').textContent = formatCurrency(totalProfit);
    document.getElementById('resultExitValue').textContent = formatCurrency(exitProceeds);
    document.getElementById('resultEntryValuation').textContent = formatCurrency(entryValuation);
    
    // Capital Events (above chart)
    document.getElementById('resultInitialEquity').textContent = '-' + formatCurrency(initialEquity);
    document.getElementById('resultSaleProceeds').textContent = '+' + formatCurrency(exitProceeds);
    
    // Update table
    updateCashflowTable(yearlyData, useDebtDay1 || useRefi);
    
    // Update chart with all cashflow data
    updateCashflowChart(yearlyData, initialEquity, exitProceeds);
}

function updateCashflowTable(yearlyData, hasDebt = false) {
    const tbody = document.getElementById('cashflowTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = yearlyData.map(row => {
        const refiNote = row.refiCashOut > 0 ? ` <span style="color: var(--teal); font-size: 10px;">(+refi)</span>` : '';
        const debtCol = hasDebt ? `<td style="padding: 8px 12px; text-align: right; color: #f97316;">${row.debtService > 0 ? '-' + formatCurrencyFull(row.debtService) : '-'}</td>` : '';
        
        return `
        <tr style="border-bottom: 1px solid var(--gray-100);">
            <td style="padding: 8px 12px; font-weight: 600;">Year ${row.year}</td>
            <td style="padding: 8px 12px; text-align: right; color: var(--teal);">${formatCurrencyFull(row.grossRent)}</td>
            <td style="padding: 8px 12px; text-align: right; color: #ef4444;">-${formatCurrencyFull(row.hoa)}</td>
            <td style="padding: 8px 12px; text-align: right; color: #ef4444;">-${formatCurrencyFull(row.propTax)}</td>
            ${debtCol}
            <td style="padding: 8px 12px; text-align: right; font-weight: 600; color: ${row.netCashflow >= 0 ? '#22c55e' : '#ef4444'};">${row.netCashflow >= 0 ? '+' : ''}${formatCurrencyFull(row.netCashflow)}${refiNote}</td>
            <td style="padding: 8px 12px; text-align: right; color: ${row.cumulative >= 0 ? '#22c55e' : '#ef4444'};">${row.cumulative >= 0 ? '+' : ''}${formatCurrencyFull(row.cumulative)}</td>
            <td style="padding: 8px 12px; text-align: right;">${formatCurrency(row.unitNAV)}</td>
            <td style="padding: 8px 12px; text-align: right; color: var(--gold); font-weight: 600;">${formatCurrency(row.landNAV)}</td>
        </tr>`;
    }).join('');
    
    // Update table header for debt column
    const thead = tbody.parentElement?.querySelector('thead tr');
    if (thead && hasDebt) {
        // Check if debt column already exists
        if (!thead.innerHTML.includes('Debt Service')) {
            const propTaxHeader = thead.querySelector('th:nth-child(4)');
            if (propTaxHeader) {
                propTaxHeader.insertAdjacentHTML('afterend', '<th style="padding: 8px 12px; text-align: right; font-weight: 600; color: var(--navy); border-bottom: 1px solid var(--gray-200);">Debt Service</th>');
            }
        }
    }
}

function updateCashflowChart(yearlyData, initialEquity, exitProceeds) {
    const canvas = document.getElementById('cashflowChart');
    if (!canvas) return;
    
    // Destroy existing chart
    if (cashflowChartInstance) {
        cashflowChartInstance.destroy();
    }
    
    const holdPeriod = yearlyData.length;
    
    if (currentChartView === 'cashflow') {
        // Focus on operating cashflows only (Years 1-N), excluding purchase and sale
        const labels = yearlyData.map(d => `Year ${d.year}`);
        
        // Prepare data arrays for operating years only
        const rentData = yearlyData.map(d => d.grossRent);
        const expensesData = yearlyData.map(d => -(d.hoa + d.propTax));
        const debtData = yearlyData.map(d => d.debtService > 0 ? -d.debtService : 0);
        const refiData = yearlyData.map(d => d.refiCashOut || 0);
        
        // Calculate net cashflow line for reference
        const netCashflowData = yearlyData.map(d => {
            const net = d.grossRent - d.hoa - d.propTax - (d.debtService || 0) + (d.refiCashOut || 0);
            return net;
        });
        
        // Check if we have any debt or refi to show
        const hasDebt = debtData.some(d => d !== 0);
        const hasRefi = refiData.some(d => d !== 0);
        
        const datasets = [
            {
                label: 'Rental Income',
                data: rentData,
                backgroundColor: 'rgba(34, 197, 94, 0.85)',
                borderColor: '#16a34a',
                borderWidth: 1,
                borderRadius: 4,
                stack: 'stack1'
            },
            {
                label: 'HOA + Taxes',
                data: expensesData,
                backgroundColor: 'rgba(251, 146, 60, 0.85)',
                borderColor: '#ea580c',
                borderWidth: 1,
                borderRadius: 4,
                stack: 'stack1'
            }
        ];
        
        if (hasDebt) {
            datasets.push({
                label: 'Debt Service',
                data: debtData,
                backgroundColor: 'rgba(239, 68, 68, 0.85)',
                borderColor: '#dc2626',
                borderWidth: 1,
                borderRadius: 4,
                stack: 'stack1'
            });
        }
        
        if (hasRefi) {
            datasets.push({
                label: 'Cash-Out Refi',
                data: refiData,
                backgroundColor: 'rgba(59, 130, 246, 0.85)',
                borderColor: '#2563eb',
                borderWidth: 1,
                borderRadius: 4,
                stack: 'stack1'
            });
        }
        
        // Add net cashflow line
        datasets.push({
            label: 'Net Cashflow',
            type: 'line',
            data: netCashflowData,
            borderColor: ChartColors.navy,
            backgroundColor: 'transparent',
            borderWidth: 3,
            pointRadius: 5,
            pointBackgroundColor: '#fff',
            pointBorderColor: ChartColors.navy,
            pointBorderWidth: 2,
            tension: 0.1,
            order: 0
        });
        
        cashflowChartInstance = new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { 
                            usePointStyle: true, 
                            padding: 12, 
                            font: { size: 11 },
                            boxWidth: 14
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (context.raw === 0) return null;
                                const value = context.raw;
                                const sign = value >= 0 ? '+' : '';
                                return context.dataset.label + ': ' + sign + formatCurrencyFull(value);
                            }
                        }
                    }
                },
                scales: {
                    x: { 
                        grid: { display: false },
                        stacked: true
                    },
                    y: {
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        stacked: true,
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });
    } else {
        // NAV view
        const labels = yearlyData.map(d => `Year ${d.year}`);
        
        cashflowChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Land NAV (Exit Value)',
                        data: yearlyData.map(d => d.landNAV),
                        borderColor: ChartColors.gold,
                        backgroundColor: 'rgba(212, 163, 115, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.2,
                        pointRadius: 6,
                        pointBackgroundColor: '#fff',
                        pointBorderWidth: 2
                    },
                    {
                        label: 'Unit NAV',
                        data: yearlyData.map(d => d.unitNAV),
                        borderColor: ChartColors.teal,
                        backgroundColor: 'rgba(0, 168, 150, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.2,
                        pointRadius: 6,
                        pointBackgroundColor: '#fff',
                        pointBorderWidth: 2
                    },
                    {
                        label: 'Initial Equity',
                        data: yearlyData.map(() => initialEquity),
                        borderColor: ChartColors.navy,
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { usePointStyle: true, padding: 15, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatCurrency(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });
    }
}

function formatPriceInput(input) {
    const cursorPos = input.selectionStart;
    const oldLength = input.value.length;
    
    let value = input.value.replace(/[^\d]/g, '');
    
    if (value) {
        value = parseInt(value, 10).toLocaleString('en-US');
    }
    
    input.value = value;
    
    const newLength = input.value.length;
    const newCursorPos = cursorPos + (newLength - oldLength);
    input.setSelectionRange(newCursorPos, newCursorPos);
}

function initCalculator() {
    const unitSelect = document.getElementById('unitTypeSelect');
    const priceInput = document.getElementById('buyPriceInput');
    const rentInput = document.getElementById('monthlyRentInput');
    const holdPeriodSelect = document.getElementById('holdPeriodSelect');
    
    // Primary inputs
    if (unitSelect) {
        unitSelect.addEventListener('change', () => {
            updateRentEstimate();
            calculateInvestment();
        });
    }
    
    if (priceInput) {
        priceInput.addEventListener('input', function() {
            formatPriceInput(this);
            calculateInvestment();
        });
    }
    
    if (rentInput) {
        rentInput.addEventListener('input', function() {
            formatPriceInput(this);
            calculateInvestment();
        });
    }
    
    if (holdPeriodSelect) holdPeriodSelect.addEventListener('change', calculateInvestment);
    
    // Assumption inputs
    const assumptionInputs = ['rentGrowthInput', 'landGrowthInput', 'unitGrowthInput', 'propTaxInput', 'expenseGrowthInput'];
    assumptionInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', calculateInvestment);
            input.addEventListener('input', calculateInvestment);
        }
    });
    
    // Reset assumptions button
    const resetBtn = document.getElementById('resetAssumptions');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            document.getElementById('rentGrowthInput').value = 3;
            document.getElementById('landGrowthInput').value = 5;
            document.getElementById('unitGrowthInput').value = 3;
            document.getElementById('propTaxInput').value = 1.41;
            document.getElementById('expenseGrowthInput').value = 2;
            calculateInvestment();
        });
    }
    
    // Chart view toggle
    const chartViewCashflow = document.getElementById('chartViewCashflow');
    const chartViewNAV = document.getElementById('chartViewNAV');
    
    if (chartViewCashflow && chartViewNAV) {
        chartViewCashflow.addEventListener('click', () => {
            currentChartView = 'cashflow';
            chartViewCashflow.style.background = 'var(--white)';
            chartViewCashflow.style.fontWeight = '600';
            chartViewNAV.style.background = 'transparent';
            chartViewNAV.style.fontWeight = '400';
            calculateInvestment();
        });
        
        chartViewNAV.addEventListener('click', () => {
            currentChartView = 'nav';
            chartViewNAV.style.background = 'var(--white)';
            chartViewNAV.style.fontWeight = '600';
            chartViewCashflow.style.background = 'transparent';
            chartViewCashflow.style.fontWeight = '400';
            calculateInvestment();
        });
    }
    
    // Financing toggle
    const useFinancing = document.getElementById('useFinancing');
    const financingOptions = document.getElementById('financingOptions');
    
    if (useFinancing && financingOptions) {
        useFinancing.addEventListener('change', () => {
            financingOptions.style.display = useFinancing.checked ? 'block' : 'none';
            calculateInvestment();
        });
    }
    
    // Financing inputs
    const financingInputs = ['financingYear', 'financingLTV', 'financingRate', 'financingTerm'];
    financingInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', calculateInvestment);
            input.addEventListener('input', calculateInvestment);
        }
    });
}

// Update the transaction data toggle counts
function updateTransactionDataCounts() {
    const rentalsBtn = document.getElementById('rentalsToggleBtn');
    if (rentalsBtn) {
        rentalsBtn.textContent = `Rentals (${rawRentalData.length})`;
    }
}

// Initialize charts when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        createImpliedValueChart('impliedValueChart');
        createPricePerSqftChart('pricePerSqftChart');
        createEntryExitChart('entryExitChart');
        createSalesScatterChart('salesScatterChart');
        createLeverageChart('leverageChart');
        createImpliedValueDistributionChart('impliedDistChart');
        createMiamiIndexChart('miamiIndexChart');
        createRentByBedsChart('rentByBedsChart');
        initRentalYearFilters();
        updateRentalMarketUI();
        
        // Initialize the interactive explorer
        createExplorerChart('impliedValueExplorer');
        updateSalesTable('all');
        initExplorerFilters();
        
        // Update transaction data toggle counts
        updateTransactionDataCounts();
        
        // Initialize the unit investment calculator
        initCalculator();
        
        // Initialize the price chart toggle
        initPriceChartToggle();
    }, 100);
});
