# Bugs:
* Video thumbnails are not cached in any way, leading to abnormally long load times.
* We should wait for the project to be deleted before redirecting to the dashboard,
* projects are created twice, not updated (different UIDs)
* on projects/:id delete project does nothing & retranscribe redirects the user to the pipeline. Instead it should show a field that allows the user to change the transcription model + a button to allow retranscription on the page. add a progress bar that allows users to track the progress.
