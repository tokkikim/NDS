class DeviceModel {
  final String id;
  final String name;
  final String? categoryId;
  final String? osType;
  final String? resolution;
  final String opStartTime;
  final String opEndTime;
  final String status;
  final String? hardwareId;
  final int totalSlots;
  final int policyPlays;
  final int slotDuration;

  DeviceModel({
    required this.id,
    required this.name,
    this.categoryId,
    this.osType,
    this.resolution,
    required this.opStartTime,
    required this.opEndTime,
    required this.status,
    this.hardwareId,
    required this.totalSlots,
    required this.policyPlays,
    required this.slotDuration,
  });

  factory DeviceModel.fromJson(Map<String, dynamic> json) {
    return DeviceModel(
      id: json['id'],
      name: json['name'],
      categoryId: json['category_id'],
      osType: json['os_type'],
      resolution: json['resolution'],
      opStartTime: json['op_start_time'] ?? '00:00:00',
      opEndTime: json['op_end_time'] ?? '23:59:59',
      status: json['status'] ?? 'offline',
      hardwareId: json['hardware_id'],
      totalSlots: json['total_slots'] ?? 10,
      policyPlays: json['policy_plays'] ?? 100,
      slotDuration: json['slot_duration'] ?? 15,
    );
  }
}

class MediaModel {
  final String id;
  final String title;
  final String fileUrl;
  final int duration;
  final String format;

  MediaModel({
    required this.id,
    required this.title,
    required this.fileUrl,
    required this.duration,
    required this.format,
  });

  factory MediaModel.fromJson(Map<String, dynamic> json) {
    return MediaModel(
      id: json['id'],
      title: json['product_name'] ?? json['title'], // productName 우선 사용
      fileUrl: json['file_url'],
      duration: json['duration'] ?? 15,
      format: json['format'] ?? 'mp4',
    );
  }
}

class ScheduleModel {
  final String id;
  final String deviceId;
  final String mediaId;
  final int slotNo;
  final String? slotStart;
  final String? slotEnd;
  final MediaModel? media;

  ScheduleModel({
    required this.id,
    required this.deviceId,
    required this.mediaId,
    required this.slotNo,
    this.slotStart,
    this.slotEnd,
    this.media,
  });

  factory ScheduleModel.fromJson(Map<String, dynamic> json) {
    return ScheduleModel(
      id: json['id'],
      deviceId: json['device_id'],
      mediaId: json['media_id'],
      slotNo: json['slot_no'] ?? 1,
      slotStart: json['slot_start'],
      slotEnd: json['slot_end'],
      media: json['medias'] != null ? MediaModel.fromJson(json['medias']) : null,
    );
  }
}
