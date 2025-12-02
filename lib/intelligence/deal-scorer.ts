export interface DealFactors {
    creditScore?: number;
    monthlyIncome?: number;
    liquidAssets?: number;
    loanAmount?: number;
    propertyValue?: number; // Purchase Price or ARV
    ltv?: number;
    dti?: number;
    experience?: string; // For investors
}

export interface DealScore {
    score: number; // 0-100
    probability: 'Low' | 'Medium' | 'High';
    recommendation: string;
    missingCriticalInfo: string[];
}

export function calculateDealScore(data: any): DealScore {
    let score = 50; // Base score
    const missing: string[] = [];

    // 1. Credit Score Impact
    if (data.creditScore) {
        if (data.creditScore >= 720) score += 20;
        else if (data.creditScore >= 660) score += 10;
        else if (data.creditScore < 600) score -= 20;
    } else {
        missing.push('Credit Score');
    }

    // 2. Income / Revenue Impact
    if (data.monthlyIncome || data.revenue) {
        const income = data.monthlyIncome || (data.revenue ? data.revenue / 12 : 0);
        if (income > 10000) score += 15;
        else if (income > 5000) score += 5;
        else score -= 5;
    } else {
        missing.push('Income/Revenue');
    }

    // 3. Asset Impact
    if (data.liquidAssets) {
        if (data.liquidAssets > 50000) score += 10;
        else if (data.liquidAssets > 10000) score += 5;
    }

    // 4. Investment Experience (Bonus)
    if (data.experience && data.experience !== '0 (First time)') {
        score += 10;
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    let probability: DealScore['probability'] = 'Medium';
    if (score >= 75) probability = 'High';
    if (score < 40) probability = 'Low';

    let recommendation = "Continue gathering standard info.";
    if (probability === 'High') recommendation = "Fast-track to application submission.";
    if (probability === 'Low') recommendation = "Suggest adding a co-signer or credit repair.";

    return {
        score,
        probability,
        recommendation,
        missingCriticalInfo: missing,
    };
}
