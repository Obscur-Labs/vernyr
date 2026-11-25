# backend/

## Course catalogue

The client's model (`legacy/server/routes/uni_catalogue.js`, `portal/catalogue.js`), in `models/University.ts` and `models/Course.ts`:

- A university has a University ID `<country code>-001` and `course_defaults`: intakes with opening date and deadline, English tests, application fee, minimum academic requirement. **Every course follows them** unless it sets `own_intakes` / `own_english` / `own_app_fee` / `own_academic`. Changing the settings re-applies them (`applyDefaults`).
- A course has a Course ID `<University ID>-0001`, embedded `intakes`, `english` and `academic`, and a status. Students only ever see `Published` courses, and a course is only published when `missingForPublish()` finds nothing missing.
- Courses are uploaded **one university at a time**: download that university's Excel, change it, upload it again. A file of another university is refused, and the upload always previews before it commits.
- `services/catalogue.ts` owns the IDs, settings, `saveCourse` (every change is written to `CourseChange`), search and the eligibility hint (a guide; the university decides).
- Logos live on Cloudinary. `GET /api/logos/:id` is public and serves the logo or a coloured initials placeholder.

## Reports

`GET /api/admin/reports` (Admin and Manager) and the Excel exports at `/api/admin/export/:entity`, from the client's `routes/admin.js`.
