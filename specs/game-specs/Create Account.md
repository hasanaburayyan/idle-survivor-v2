Overview
Allow users to create new accounts and login to existing accounts

User Story
As a new user I want to navigate to a landing page for the game and be greeted with the option to sign in or sign up.

After either path I should find myself at the game's home screen.

Requirements:
- Signup flow exists
	- requires a username and password
	- usernames must be unique
		- if I enter an already taken username I should be notified right away
- Login flow exists
	- login with username and password
	- do not tell user which field is invalid if login fails, just display a notification that login combo does not work

Non-Functional Requirements
- passwords should not be saved in plain text
	- use hash and maybe a salt
