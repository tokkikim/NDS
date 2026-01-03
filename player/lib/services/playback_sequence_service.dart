import '../models/models.dart';
import '../utils/time_utils.dart';

class PlaybackSequenceService {
  final List<ScheduleModel> schedules;
  final int totalSlots;
  final int policyPlays;
  final int defaultSlotDuration;

  PlaybackSequenceService({
    required this.schedules,
    required this.totalSlots,
    this.policyPlays = 100,
    this.defaultSlotDuration = 15,
  });

  // CMS(page.tsx)의 timelineData 시뮬레이션 로직과 100% 일치하도록 구현
  // 절대 시각(slotStart/End)을 준수하며 공백은 블랙(null)으로 처리
  List<ScheduleModel> generateSequence(int opSeconds, String opStartTime) {
    if (schedules.isEmpty && totalSlots > 0) {
       // 광고가 전혀 없어도 운영 시간은 채워야 함 (전체 블랙)
       return [
         ScheduleModel(
           id: 'gap', 
           deviceId: '', 
           mediaId: 'black',
           slotNo: 0, 
           media: MediaModel(id: 'black', title: 'Black Screen', fileUrl: '', duration: opSeconds, format: 'black')
         )
       ];
    }

    // 1. 구좌별 스케줄 그룹화 및 파라미터 계산
    final List<Map<String, dynamic>> slotData = [];
    for (int i = 1; i <= totalSlots; i++) {
      final scheds = schedules.where((s) => s.slotNo == i).toList();
      
      // CMS logic: slotEffectiveDuration = Math.max(defaultSlotDuration, totalMediasDuration)
      final totalMediasDuration = scheds.fold<int>(0, (sum, s) => sum + (s.media?.duration ?? 0));
      final slotEffectiveDuration = totalMediasDuration > defaultSlotDuration 
          ? totalMediasDuration 
          : defaultSlotDuration;

      final List<Map<String, dynamic>> processedScheds = scheds.map((s) {
        // CMS의 playsPerCycle 계산식 그대로 적용
        final mediaCount = scheds.length;
        final playsPerCycle = (slotEffectiveDuration / mediaCount) / (s.media?.duration ?? defaultSlotDuration);
        return {
          'model': s,
          'playsPerCycle': playsPerCycle,
          'count': 0,
          'targetPlays': 100, // 추후 CMS 설정값 연동
        };
      }).toList();

      slotData.add({
        'no': i,
        'scheds': processedScheds,
      });
    }

    final List<ScheduleModel> sequence = [];
    final activeSlots = slotData.where((s) => (s['scheds'] as List).isNotEmpty).toList();
    
    // [Fix] 구좌 번호 순서대로 정렬하여 CMS와 맞춤
    activeSlots.sort((a, b) => (a['no'] as int).compareTo(b['no'] as int));
    
    int currentTime = 0;
    int cycleIdx = 0;
    int safeguard = 0;

    int startAbsSeconds = TimeUtils.parseTimeToSeconds(opStartTime);

    // CMS timelineData while 루프 이식
    while (currentTime < opSeconds && safeguard < 200000) {
      String currentAbsTimeStr = TimeUtils.secondsToTimeString(startAbsSeconds + currentTime);
      
      bool anyPlayedInCycle = false;
      int sweepCount = 0;

      while (sweepCount < 10 && currentTime < opSeconds) {
        bool playedInSweep = false;

        for (var slot in activeSlots) {
          if (currentTime >= opSeconds) break;

          final List<Map<String, dynamic>> scheds = slot['scheds'];
          int bestIdx = -1;
          double minRatio = double.infinity;

          for (int mIdx = 0; mIdx < scheds.length; mIdx++) {
            final sData = scheds[mIdx];
            final model = sData['model'] as ScheduleModel;
            
            // [추가] 현재 시각에 해당 광고가 편성되어 있는지 체크
            if (model.slotStart != null && model.slotEnd != null) {
              if (!TimeUtils.isTimeInRange(currentAbsTimeStr, model.slotStart!, model.slotEnd!)) {
                continue;
              }
            }

            final targetForThisCycle = (cycleIdx + 1) * (sData['playsPerCycle'] as double);
            
            if (sData['count'] < targetForThisCycle) {
              final ratio = sData['count'] / targetForThisCycle;
              if (ratio < minRatio) {
                minRatio = ratio;
                bestIdx = mIdx;
              }
            }
          }

          if (bestIdx != -1) {
            final sData = scheds[bestIdx];
            final model = sData['model'] as ScheduleModel;
            final duration = model.media?.duration ?? defaultSlotDuration;

            sequence.add(model);
            currentTime += duration;
            sData['count']++;
            playedInSweep = true;
            anyPlayedInCycle = true;
            
            // 시각 업데이트
            currentAbsTimeStr = TimeUtils.secondsToTimeString(startAbsSeconds + currentTime);
          }
        }
        if (!playedInSweep) break;
        sweepCount++;
      }

      if (!anyPlayedInCycle) {
        // 현재 시점 이후에 가장 빨리 시작하는 광고 시각을 찾아 그만큼만 공백(Gap)을 추가함
        int nextStartSeconds = 86400 * 2; // 매우 큰 값으로 초기화
        for (var slot in activeSlots) {
          for (var sData in slot['scheds']) {
            final model = sData['model'] as ScheduleModel;
            if (model.slotStart != null) {
              int sStart = TimeUtils.parseTimeToSeconds(model.slotStart!);
              if (sStart > (startAbsSeconds + currentTime)) {
                if (sStart < nextStartSeconds) nextStartSeconds = sStart;
              }
            }
          }
        }

        int gapDuration;
        if (nextStartSeconds < 86400 * 2) {
          gapDuration = nextStartSeconds - (startAbsSeconds + currentTime);
        } else {
          // 더 이상 편성된 광고가 없음 -> 운영 종료까지 블랙 처리
          gapDuration = opSeconds - currentTime;
        }

        if (gapDuration > 0) {
          sequence.add(ScheduleModel(
            id: 'gap_$currentTime',
            deviceId: '',
            mediaId: 'black',
            slotNo: 0,
            media: MediaModel(id: 'black', title: 'Black Screen', fileUrl: '', duration: gapDuration, format: 'black'),
          ));
          currentTime += gapDuration;
          currentAbsTimeStr = TimeUtils.secondsToTimeString(startAbsSeconds + currentTime);
        } else {
          currentTime += 1; // 무한 루프 방지
        }
      }

      cycleIdx++;
      safeguard++;
    }

    print('[SyncDebug] Absolute Sequence Generated: $currentTime / $opSeconds seconds');
    return sequence;
  }
}
