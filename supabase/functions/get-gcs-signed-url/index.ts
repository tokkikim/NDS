import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { Storage } from "npm:@google-cloud/storage@7.7.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-goog-resumable',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Expose-Headers': 'Location',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const keyText = Deno.env.get('GCP_SERVICE_ACCOUNT_KEY')
        if (!keyText) throw new Error('GCP_SERVICE_ACCOUNT_KEY not set')

        const { action, mediaId, fileExt, contentType } = await req.json()
        const storage = new Storage({ credentials: JSON.parse(keyText) })
        const bucketName = Deno.env.get('GCS_BUCKET_NAME') || 'nds-ads-storage'

        const isUpload = action === 'upload'
        const filePath = isUpload ? `raw/${mediaId}.${fileExt}` : `processed/${mediaId}.mp4`
        const bucket = storage.bucket(bucketName)
        const file = bucket.file(filePath)

        if (isUpload) {
            // 이어올리기(Resumable) 세션 시작을 위한 Signed URL 생성
            // 이 URL로 POST 요청을 보내면 업로드 세션 ID가 포함된 Location 헤더를 받을 수 있습니다.
            const [signedUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'resumable',
                expires: Date.now() + 60 * 60 * 1000, // 1시간 유효
                contentType: contentType,
            })

            return new Response(JSON.stringify({ signedUrl, filePath }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        } else {
            // 기존 다운로드용 Signed URL (Read)
            const [signedUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 60 * 60 * 1000,
            })
            return new Response(JSON.stringify({ signedUrl, filePath }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
