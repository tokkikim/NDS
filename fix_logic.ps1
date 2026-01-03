
$path = 'c:\coding\NDS\src\app\schedules\timetable\page.tsx'
$content = Get-Content $path -Raw

$oldBlock = @'
            // 정책 목표(basePolicy) 만큼 구좌 바퀴를 돌면서 실제 어떤 소재가 나갈지 시뮬레이션
            for (let cycle = 0; cycle < basePolicy; cycle++) {
                params.slotData.forEach((slot: any, sIdx: number) => {
                    const pointer = pointers[sIdx];
                    const budget = slot.budgetPerCycle;
                    
                    if (slot.scheds.length > 0) {
                        let spent = 0;
                        let localSafeguard = 0;

                        while (spent < budget - 2 && localSafeguard < 10) {
                            let bestIdx = 0;
                            let minRatio = Infinity;
                            for (let mIdx = 0; mIdx < slot.scheds.length; mIdx++) {
                                const target = (slot.scheds[mIdx] as any).targetPlays || 1;
                                const ratio = pointer.counts[mIdx] / target;
                                if (ratio < minRatio) {
                                    minRatio = ratio;
                                    bestIdx = mIdx;
                                }
                            }
                            const sched = slot.scheds[bestIdx];
                            const dur = Math.max(sched.medias?.duration || 0, 1);
                            if (spent > 0 && spent + dur > budget + (dur / 2)) break;

                            sequence.push({
                                slotNo: slot.no,
                                sched,
                                duration: dur,
                                cycleNo: cycle + 1
                            });
                            spent += dur;
                            pointer.counts[bestIdx]++;
                            localSafeguard++;
                        }
                    } else {
                        sequence.push({
                            slotNo: slot.no,
                            sched: null,
                            duration: params.defaultSlotDuration,
                            cycleNo: cycle + 1
                        });
                    }
                });
            }
'@

$newBlock = @'
            // 모든 소재가 자신의 정책 목표를 채울 때까지 롤링 시뮬레이션 (순차 교차 방식)
            let safeguard = 0;
            let allFinished = false;

            while (!allFinished && safeguard < 1000) {
                allFinished = true;
                params.slotData.forEach((slot: any, sIdx: number) => {
                    const pointer = pointers[sIdx];
                    
                    if (slot.scheds.length > 0) {
                        let bestIdx = 0;
                        let minRatio = Infinity;
                        let anyPending = false;

                        for (let mIdx = 0; mIdx < slot.scheds.length; mIdx++) {
                            const target = (slot.scheds[mIdx] as any).targetPlays || 1;
                            const ratio = pointer.counts[mIdx] / target;
                            if (ratio < 1) anyPending = true;
                            
                            if (ratio < minRatio) {
                                minRatio = ratio;
                                bestIdx = mIdx;
                            }
                        }

                        if (anyPending) {
                            allFinished = false;
                            const sched = slot.scheds[bestIdx];
                            const dur = Math.max(sched.medias?.duration || 0, 1);
                            
                            sequence.push({
                                slotNo: slot.no,
                                sched,
                                duration: dur,
                                cycleNo: Math.floor(pointer.counts.reduce((a, b) => a + b, 0) / slot.scheds.length) + 1
                            });
                            pointer.counts[bestIdx]++;
                        }
                    } else {
                        sequence.push({
                            slotNo: slot.no,
                            sched: null,
                            duration: params.defaultSlotDuration,
                            cycleNo: safeguard + 1
                        });
                    }
                });
                safeguard++;
                if (sequence.length > 500) break;
            }
'@

# We use a regex or simple string replacement. Since the block is unique enough, simple replacement should work if we normalize line endings.
$content = $content.Replace($oldBlock.Replace("`r`n", "`n"), $newBlock.Replace("`r`n", "`n"))
Set-Content $path $content -NoNewline
