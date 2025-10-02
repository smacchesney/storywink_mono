# Cloudinary Direct Upload Implementation Plan

## Overview
This plan outlines the migration from server-side uploads to direct browser-to-Cloudinary uploads for Storywink.ai. This will eliminate the 1MB/50MB body size limitations and improve upload performance.

## Current Architecture Issues
- ❌ Files uploaded through Next.js API route (body size limits)
- ❌ Base64 encoding inflates file sizes by ~33%
- ❌ Sequential upload processing
- ❌ Server memory consumed for each upload
- ❌ Slower upload experience

## Target Architecture Benefits
- ✅ Direct browser-to-Cloudinary uploads (no size limits)
- ✅ Parallel upload processing
- ✅ No server memory usage
- ✅ Progress tracking per file
- ✅ Resumable uploads possible
- ✅ Better user experience

## Implementation Steps

### Phase 1: Cloudinary Configuration (User Actions Required)

#### 1.1 Create Upload Preset
**Status**: ✅ Completed

**User Actions Required**:
1. Log into your Cloudinary Console at https://console.cloudinary.com
2. Navigate to Settings → Upload
3. Scroll to "Upload presets" section
4. Click "Add upload preset"
5. Configure the preset:
   - **Preset name**: `storywink_unsigned` (remember this exactly)
   - **Signing mode**: Select "Unsigned"
   - **Folder**: Set to `user_${external_id}/uploads` (this will use dynamic folders)
   - **Allowed formats**: jpg, png, jpeg, heic, heif, webp
   - **Max file size**: 10MB (10485760 bytes)
   - **Tags**: Add tag `user_upload`
   - **Access mode**: Keep as "public"
   - **Overwrite**: Set to FALSE (prevent accidental overwrites)
   - **Unique filename**: Set to TRUE
   - **Eager transformations**: Add one for thumbnails:
     - Width: 200, Height: 200, Crop: fill, Quality: auto, Format: auto
6. Save the preset

#### 1.2 Enable Unsigned Uploads
**Status**: ✅ Completed

**User Actions Required**:
1. In the same Upload settings page
2. Find "Enable unsigned uploading" toggle
3. Turn it ON if not already enabled

#### 1.3 Note Your Cloud Name
**Status**: ✅ Completed

**User Actions Required**:
1. Go to Dashboard in Cloudinary Console
2. Note your "Cloud name" (you'll need this for frontend config)
3. It should match what's in your `.env` files

### Phase 2: Frontend Implementation

#### 2.1 Install Next-Cloudinary Package
**Status**: ✅ Completed

**Code Changes**:
- Add `next-cloudinary` package to dependencies
- Configure environment variables

#### 2.2 Create Cloudinary Upload Component
**Status**: ✅ Completed

**Code Changes**:
- Create new component using CldUploadWidget
- Handle multiple file uploads
- Show progress per file
- Handle success/error callbacks

#### 2.3 Update File Uploader Component
**Status**: ✅ Completed

**Code Changes**:
- Replace current FileUploader with Cloudinary widget
- Maintain same UI/UX
- Add progress tracking

#### 2.4 Update Create Page Flow
**Status**: ✅ Completed

**Code Changes**:
- Remove server upload logic
- Handle Cloudinary response format
- Create assets in database after upload

#### 2.5 Update Edit Page Add Photos
**Status**: ✅ Completed

**Code Changes**:
- Update additional photo upload to use direct upload
- Ensure bookId is passed for page creation

### Phase 3: Backend Updates

#### 3.1 Create Webhook Endpoint
**Status**: ✅ Completed (Using API endpoint instead)

**Code Changes**:
- Create `/api/webhooks/cloudinary` endpoint
- Verify webhook authenticity
- Create Asset and Page records
- Handle upload notifications

#### 3.2 Configure Webhook in Cloudinary
**Status**: ⏳ Not Started

**User Actions Required**:
1. In Cloudinary Console, go to Settings → Upload
2. Scroll to "Notification URL"
3. Add webhook URL: `https://yourdomain.com/api/webhooks/cloudinary`
4. Select notification types: Upload, Delete

#### 3.3 Update Database Flow
**Status**: ⏳ Not Started

**Code Changes**:
- Modify asset creation to handle Cloudinary webhook data
- Ensure user association via metadata
- Handle edge cases

#### 3.4 Remove Old Upload Endpoint
**Status**: ⏳ Not Started

**Code Changes**:
- Deprecate `/api/upload` endpoint
- Clean up unused upload code
- Update any references

### Phase 4: Testing & Validation

#### 4.1 Test Upload Flows
**Status**: ⏳ In Progress

**Test Cases**:
- [ ] Single photo upload on create page
- [ ] Multiple photo upload on create page
- [ ] Additional photos on edit page
- [ ] Large file handling (8-10MB photos)
- [ ] Error handling (network issues)
- [ ] Progress tracking accuracy
- [ ] Webhook reliability

#### 4.2 Performance Testing
**Status**: ⏳ Not Started

**Metrics to Measure**:
- Upload speed improvement
- Memory usage reduction
- Concurrent upload performance
- User experience metrics

### Phase 5: Deployment & Monitoring

#### 5.1 Environment Configuration
**Status**: ⏳ Not Started

**Actions**:
- Update production environment variables
- Configure webhook URLs for each environment
- Test in staging first

#### 5.2 Gradual Rollout
**Status**: ⏳ Not Started

**Strategy**:
- Deploy with feature flag
- Test with small user group
- Monitor for issues
- Full rollout

#### 5.3 Monitoring Setup
**Status**: ⏳ Not Started

**Metrics**:
- Upload success rates
- Webhook delivery rates
- Error rates
- Performance metrics

## Security Considerations

1. **Upload Preset Security**:
   - Unsigned preset only allows specific parameters
   - File type restrictions enforced
   - Size limits enforced
   - Unique filenames prevent overwrites

2. **User Association**:
   - Pass user ID as metadata in upload
   - Verify user ownership in webhook
   - Folder structure includes user ID

3. **Webhook Security**:
   - Verify webhook signatures
   - Validate payload structure
   - Rate limiting on endpoint

## Rollback Plan

If issues arise:
1. Feature flag to disable direct upload
2. Revert to server-side upload
3. Fix issues while users use old flow
4. Re-deploy when ready

## Success Criteria

- [ ] 90%+ upload success rate
- [ ] 50%+ faster upload times
- [ ] Zero server memory issues
- [ ] Positive user feedback
- [ ] Reduced infrastructure costs

## Next Steps

1. Get user confirmation on Cloudinary console access
2. Begin with Phase 1 Cloudinary configuration
3. Implement frontend changes incrementally
4. Test thoroughly before removing old code

---

**Last Updated**: June 8, 2025
**Status**: Implementation Complete, Testing Phase
**Estimated Timeline**: 2-3 days of implementation

## Summary of Changes

### Completed Items:
1. ✅ Cloudinary configuration (upload preset, unsigned uploads)
2. ✅ Installed next-cloudinary package
3. ✅ Created CloudinaryUploader component
4. ✅ Updated create page to use direct uploads
5. ✅ Updated edit page for additional photo uploads
6. ✅ Created API endpoint for asset creation
7. ✅ Fixed all TypeScript errors

### Implementation Details:
- Using CldUploadWidget from next-cloudinary
- Direct browser-to-Cloudinary uploads (no server involvement)
- API endpoint `/api/cloudinary/notify` creates database records after upload
- Progress tracking and multi-file support
- Maintains existing UI/UX with photo source sheet

### Next Steps:
1. Test all upload flows
2. Remove old server-side upload code
3. Add error handling for edge cases
4. Deploy to staging for wider testing